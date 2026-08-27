// @effect-diagnostics globalDate:off
// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import type { CodexSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as CodexClient from "effect-codex-app-server/client";
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

const CODEX_IMPORT_FORCE_KILL_AFTER = "2 seconds" as const;
const MAX_IMPORT_MESSAGES = 2_000;
const THREAD_LIST_PAGE_SIZE = 100;
const INTERACTIVE_SOURCE_KINDS = ["cli", "vscode", "appServer"] as const;

function normalizePath(path: string): string {
  const resolved = NodePath.normalize(NodePath.resolve(path));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
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
          .filter((input): input is Extract<(typeof item.content)[number], { type: "text" }> =>
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

  return {
    externalThreadId: thread.id,
    title: titleForThread(thread),
    preview: thread.preview.trim().length > 0 ? thread.preview.trim().slice(0, 240) : null,
    sourceCwd: String(thread.cwd),
    createdAt: isoFromEpochSeconds(thread.createdAt, thread.updatedAt),
    updatedAt: isoFromEpochSeconds(thread.updatedAt, thread.createdAt),
    archived,
    messages: retained,
    resumeCursor: { threadId: thread.id },
    warnings,
  };
}

export function makeCodexThreadImport(input: {
  readonly config: CodexSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner;
}): ProviderThreadImportShape {
  const resolvedHomePath = input.config.homePath ? expandHomePath(input.config.homePath) : undefined;
  const launchArgs = resolveCodexLaunchArgs(input.config.launchArgs, input.environment);
  const environment = {
    ...input.environment,
    ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
  };

  const withClient = <A>(
    operation: (client: CodexClient.CodexAppServerClient["Service"]) => Effect.Effect<A, unknown>,
    importOperation: "scan" | "read",
  ): Effect.Effect<A, ProviderThreadImportError> =>
    Effect.gen(function* () {
      const spawnCommand = yield* resolveSpawnCommand(
        input.config.binaryPath,
        codexAppServerArgs(launchArgs),
        { env: environment, extendEnv: true },
      );
      const child = yield* input.spawner.spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          cwd: process.cwd(),
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
      Effect.mapError(
        (cause) =>
          new ProviderThreadImportError({
            operation: importOperation,
            detail: `Codex app-server thread ${importOperation} failed.`,
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
      let cursor: string | null | undefined = undefined;
      do {
        const response = yield* client.request("thread/list", {
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
        cursor = response.nextCursor;
      } while (cursor);
      return candidates;
    });

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
          client
            .request("thread/read", { threadId: externalThreadId, includeTurns: true })
            .pipe(
              Effect.flatMap((response) => {
                if (normalizePath(String(response.thread.cwd)) !== normalizePath(projectRoot)) {
                  return Effect.fail(
                    new Error(
                      `Codex thread '${externalThreadId}' no longer belongs to '${projectRoot}'.`,
                    ),
                  );
                }
                return Effect.succeed(extractTranscript(response.thread, archived));
              }),
            ),
        "read",
      ),
  };
}
