// @effect-diagnostics globalDate:off
// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import type { CodexSettings } from "@t3tools/contracts";
import { HostProcessPlatform, HostProcessWorkingDirectory } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as CodexClient from "effect-codex-app-server/client";
import type * as CodexErrors from "effect-codex-app-server/errors";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { expandHomePath } from "../../pathExpansion.ts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import {
  type ProviderThreadImportCandidate,
  ProviderThreadImportError,
  type ProviderThreadImportMessage,
  type ProviderThreadImportShape,
  type ProviderThreadImportTranscript,
} from "../ProviderThreadImport.ts";
import { codexAppServerArgs, resolveCodexLaunchArgs } from "./codexLaunchArgs.ts";
import { buildCodexInitializeParams } from "./CodexProvider.ts";
import {
  isUnsupportedCodexTurnHistoryError,
  readCodexRolloutTranscript,
} from "./CodexRolloutTranscript.ts";

const CODEX_IMPORT_FORCE_KILL_AFTER = "2 seconds" as const;
const MAX_IMPORT_MESSAGES = 2_000;
const THREAD_LIST_PAGE_SIZE = 100;
const INTERACTIVE_SOURCE_KINDS = ["cli", "vscode", "appServer"] as const;

function causeDetail(cause: unknown): string | undefined {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message.trim();
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = cause.message;
    if (typeof message === "string" && message.trim().length > 0) return message.trim();
  }
  return undefined;
}

function normalizePath(path: string, platform: NodeJS.Platform): string {
  const resolved = NodePath.normalize(NodePath.resolve(path));
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isoFromEpochSeconds(value: number | null | undefined, fallback: number): string {
  const seconds = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return new Date(seconds * 1_000).toISOString();
}

function titleForThread(thread: CodexSchema.V2ThreadListResponse["data"][number]): string {
  const name = thread.name?.trim();
  if (name) return name.slice(0, 96);
  const preview = thread.preview.trim().replace(/\s+/g, " ");
  return preview.length > 0 ? preview.slice(0, 96) : "Codex conversation";
}

function candidateFromThread(
  thread: CodexSchema.V2ThreadListResponse["data"][number],
  archived: boolean,
): ProviderThreadImportCandidate {
  return {
    externalThreadId: thread.id,
    title: titleForThread(thread),
    preview: thread.preview.trim().length > 0 ? thread.preview.trim().slice(0, 240) : null,
    sourceCwd: String(thread.cwd),
    createdAt: isoFromEpochSeconds(thread.createdAt, thread.updatedAt),
    updatedAt: isoFromEpochSeconds(thread.updatedAt, thread.createdAt),
    archived,
    warnings: [],
  };
}

function transcriptFromMessages(
  thread: CodexSchema.V2ThreadReadResponse["thread"],
  archived: boolean,
  messages: ReadonlyArray<ProviderThreadImportMessage>,
  warnings: ReadonlyArray<string>,
): ProviderThreadImportTranscript {
  return {
    externalThreadId: thread.id,
    title: titleForThread(thread),
    preview: thread.preview.trim().length > 0 ? thread.preview.trim().slice(0, 240) : null,
    sourceCwd: String(thread.cwd),
    createdAt: isoFromEpochSeconds(thread.createdAt, thread.updatedAt),
    updatedAt: isoFromEpochSeconds(thread.updatedAt, thread.createdAt),
    archived,
    messages,
    resumeCursor: { threadId: thread.id },
    warnings,
  };
}

function extractTranscript(
  thread: CodexSchema.V2ThreadReadResponse["thread"],
  archived: boolean,
): ProviderThreadImportTranscript {
  const messages: ProviderThreadImportMessage[] = [];
  let skippedRichInputs = 0;

  for (const turn of thread.turns) {
    const userTimestamp = isoFromEpochSeconds(turn.startedAt, thread.createdAt);
    const assistantTimestamp = isoFromEpochSeconds(
      turn.completedAt ?? turn.startedAt,
      thread.updatedAt,
    );

    for (const item of turn.items) {
      if (item.type === "userMessage") {
        const textInputs = item.content
          .filter(
            (input): input is Extract<(typeof item.content)[number], { type: "text" }> =>
              input.type === "text",
          )
          .map((input) => input.text.trim())
          .filter((text) => text.length > 0);
        skippedRichInputs += item.content.length - textInputs.length;
        const text = textInputs.join("\n\n").trim();
        if (text.length > 0) {
          messages.push({ role: "user", text, createdAt: userTimestamp });
        }
      } else if (item.type === "agentMessage") {
        const text = item.text.trim();
        if (text.length > 0) {
          messages.push({ role: "assistant", text, createdAt: assistantTimestamp });
        }
      }
    }
  }

  const warnings: string[] = [];
  if (skippedRichInputs > 0) {
    warnings.push(
      `${skippedRichInputs} non-text user input${skippedRichInputs === 1 ? " was" : "s were"} omitted from the imported transcript.`,
    );
  }

  const truncated = messages.length > MAX_IMPORT_MESSAGES;
  const retained = truncated ? messages.slice(-MAX_IMPORT_MESSAGES) : messages;
  if (truncated) {
    warnings.push(`Older messages were omitted after the ${MAX_IMPORT_MESSAGES}-message limit.`);
  }

  return transcriptFromMessages(thread, archived, retained, warnings);
}

export function makeCodexThreadImport(input: {
  readonly config: CodexSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  /** Canonical persisted history home; distinct from per-account auth overlays. */
  readonly historyHomePath?: string;
}): ProviderThreadImportShape {
  const resolvedHomePath = input.historyHomePath
    ? expandHomePath(input.historyHomePath)
    : input.config.homePath
      ? expandHomePath(input.config.homePath)
      : undefined;
  const launchArgs = resolveCodexLaunchArgs(input.config.launchArgs, input.environment);
  const environment = {
    ...input.environment,
    ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
  };

  const withClient = <A, E>(
    operation: (client: CodexClient.CodexAppServerClient["Service"]) => Effect.Effect<A, E, never>,
    importOperation: "scan" | "read",
  ): Effect.Effect<A, ProviderThreadImportError> =>
    Effect.gen(function* () {
      const workingDirectory = yield* HostProcessWorkingDirectory;
      const spawnCommand = yield* resolveSpawnCommand(
        input.config.binaryPath,
        codexAppServerArgs(launchArgs),
        { env: environment, extendEnv: true },
      );
      const child = yield* input.spawner.spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          cwd: workingDirectory,
          env: environment,
          extendEnv: true,
          forceKillAfter: CODEX_IMPORT_FORCE_KILL_AFTER,
          shell: spawnCommand.shell,
        }),
      );
      const clientContext = yield* Layer.build(CodexClient.layerChildProcess(child));
      const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
        Effect.provide(clientContext),
      );
      yield* client.request("initialize", buildCodexInitializeParams());
      yield* client.notify("initialized", undefined);
      return yield* operation(client);
    }).pipe(
      Effect.scoped,
      Effect.mapError((cause) =>
        cause instanceof ProviderThreadImportError
          ? cause
          : new ProviderThreadImportError({
              operation: importOperation,
              detail: (() => {
                const detail = causeDetail(cause);
                return detail === undefined
                  ? `Codex app-server thread ${importOperation} failed.`
                  : `Codex app-server thread ${importOperation} failed: ${detail}`;
              })(),
              cause,
            }),
      ),
    );

  const listArchivedState = (
    client: CodexClient.CodexAppServerClient["Service"],
    projectRoot: string,
    archived: boolean,
  ) =>
    Effect.gen(function* () {
      const candidates: ProviderThreadImportCandidate[] = [];
      let cursor: string | null = null;
      do {
        const response: CodexSchema.V2ThreadListResponse = yield* client.request("thread/list", {
          cursor,
          limit: THREAD_LIST_PAGE_SIZE,
          sortKey: "updated_at",
          sortDirection: "desc",
          archived,
          cwd: projectRoot,
          sourceKinds: [...INTERACTIVE_SOURCE_KINDS],
        });
        for (const thread of response.data) {
          if (thread.parentThreadId !== null || thread.ephemeral) continue;
          candidates.push(candidateFromThread(thread, archived));
        }
        cursor = response.nextCursor ?? null;
      } while (cursor);
      return candidates;
    });

  const ensureProjectThread = (
    thread: CodexSchema.V2ThreadReadResponse["thread"],
    projectRoot: string,
    externalThreadId: string,
  ) =>
    Effect.flatMap(HostProcessPlatform, (platform) => {
      if (normalizePath(String(thread.cwd), platform) !== normalizePath(projectRoot, platform)) {
        return Effect.fail(
          new ProviderThreadImportError({
            operation: "read",
            detail: `Codex thread '${externalThreadId}' no longer belongs to '${projectRoot}'.`,
          }),
        );
      }
      return Effect.succeed(thread);
    });

  const readPersistedRollout = (
    client: CodexClient.CodexAppServerClient["Service"],
    projectRoot: string,
    externalThreadId: string,
    archived: boolean,
  ): Effect.Effect<
    ProviderThreadImportTranscript,
    ProviderThreadImportError | CodexErrors.CodexAppServerError
  > => {
    if (!resolvedHomePath) {
      return Effect.fail(
        new ProviderThreadImportError({
          operation: "read",
          detail: `Codex thread '${externalThreadId}' could not use the persisted rollout fallback because the canonical history home is unavailable.`,
        }),
      );
    }
    return client.request("thread/read", { threadId: externalThreadId, includeTurns: false }).pipe(
      Effect.flatMap((response) =>
        ensureProjectThread(response.thread, projectRoot, externalThreadId),
      ),
      Effect.flatMap((thread) => {
        const rolloutPath = (
          thread as CodexSchema.V2ThreadReadResponse["thread"] & {
            readonly path?: string | null;
          }
        ).path;
        if (!rolloutPath) {
          return Effect.fail(
            new ProviderThreadImportError({
              operation: "read",
              detail: `Codex thread '${externalThreadId}' has no persisted rollout path for history fallback.`,
            }),
          );
        }
        return readCodexRolloutTranscript({
          rolloutPath,
          historyHomePath: resolvedHomePath,
          externalThreadId,
          fallbackTimestamp: isoFromEpochSeconds(thread.createdAt, thread.updatedAt),
          maxMessages: MAX_IMPORT_MESSAGES,
        }).pipe(
          Effect.map(({ messages, warnings }) =>
            transcriptFromMessages(thread, archived, messages, warnings),
          ),
        );
      }),
    );
  };

  return {
    scan: ({ projectRoot }) =>
      withClient(
        (client) =>
          Effect.all(
            [
              listArchivedState(client, projectRoot, false),
              listArchivedState(client, projectRoot, true),
            ],
            { concurrency: 2 },
          ).pipe(
            Effect.map(([active, archived]) =>
              [...active, ...archived].toSorted(
                (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
              ),
            ),
          ),
        "scan",
      ),
    read: ({ projectRoot, externalThreadId, archived }) =>
      withClient(
        (client) =>
          client.request("thread/read", { threadId: externalThreadId, includeTurns: true }).pipe(
            Effect.flatMap((response) =>
              ensureProjectThread(response.thread, projectRoot, externalThreadId),
            ),
            Effect.map((thread) => extractTranscript(thread, archived)),
            Effect.catch((cause) =>
              isUnsupportedCodexTurnHistoryError(cause)
                ? readPersistedRollout(client, projectRoot, externalThreadId, archived)
                : Effect.fail(cause),
            ),
          ),
        "read",
      ),
  };
}
