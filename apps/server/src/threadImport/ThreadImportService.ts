// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  MessageId,
  ProviderDriverKind,
  ThreadId,
  ThreadImportCandidateId,
  type ModelSelection,
  type OrchestrationProjectShell,
  type ProviderInstanceId,
  type ThreadImportCandidate,
  type ThreadImportCommitInput,
  type ThreadImportCommitResult,
  type ThreadImportItemResult,
  ThreadImportError,
  type ThreadImportMessage,
  type ThreadImportScanInput,
  type ThreadImportScanResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import type { ProviderThreadImportShape } from "../provider/ProviderThreadImport.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import {
  type ProviderRuntimeBinding,
  ProviderSessionDirectory,
} from "../provider/Services/ProviderSessionDirectory.ts";

const CODEX_DRIVER = ProviderDriverKind.make("codex");
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const isThreadImportError = Schema.is(ThreadImportError);

const error = (code: ConstructorParameters<typeof ThreadImportError>[0]["code"], message: string) =>
  new ThreadImportError({ code, message });

function stableHash(value: string): string {
  return NodeCrypto.createHash("sha256").update(value).digest("hex");
}

interface ImportCapableProviderInstance extends ProviderInstance {
  readonly threadImport: ProviderThreadImportShape;
}

function hasThreadImport(instance: ProviderInstance): instance is ImportCapableProviderInstance {
  return "threadImport" in instance && instance.threadImport !== undefined;
}

function canonicalCodexInstances(
  instances: ReadonlyArray<ProviderInstance>,
  preferredInstanceId: ProviderInstanceId | null | undefined,
) {
  const byContinuationKey = new Map<string, ImportCapableProviderInstance>();
  for (const instance of instances) {
    if (instance.driverKind !== CODEX_DRIVER || !instance.enabled || !hasThreadImport(instance))
      continue;
    const key = instance.continuationIdentity.continuationKey;
    const existing = byContinuationKey.get(key);
    if (
      existing === undefined ||
      (preferredInstanceId !== null &&
        preferredInstanceId !== undefined &&
        instance.instanceId === preferredInstanceId &&
        existing.instanceId !== preferredInstanceId)
    ) {
      byContinuationKey.set(key, instance);
    }
  }
  return [...byContinuationKey.values()];
}

function candidateIdFor(input: {
  readonly continuationKey: string;
  readonly externalThreadId: string;
  readonly projectRoot: string;
}): ThreadImportCandidateId {
  return ThreadImportCandidateId.make(
    `codex:${stableHash(
      `${input.continuationKey}\0${input.externalThreadId}\0${input.projectRoot}`,
    ).slice(0, 48)}`,
  );
}

function importedThreadId(candidateId: ThreadImportCandidateId): ThreadId {
  return ThreadId.make(`imported:${stableHash(String(candidateId)).slice(0, 40)}`);
}

function importedMessageId(input: {
  readonly candidateId: ThreadImportCandidateId;
  readonly index: number;
  readonly role: string;
  readonly text: string;
}): MessageId {
  return MessageId.make(
    `imported-message:${stableHash(
      `${input.candidateId}\0${input.index}\0${input.role}\0${input.text}`,
    ).slice(0, 40)}`,
  );
}

function importMessages(
  candidateId: ThreadImportCandidateId,
  messages: ReadonlyArray<{
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
    readonly createdAt: string;
  }>,
): ReadonlyArray<ThreadImportMessage> {
  return messages.map((message, index) => ({
    id: importedMessageId({
      candidateId,
      index,
      role: message.role,
      text: message.text,
    }),
    role: message.role,
    text: message.text,
    createdAt: message.createdAt as ThreadImportMessage["createdAt"],
  }));
}

function modelSelectionFor(
  instanceId: ProviderInstanceId,
  providerSnapshot: {
    readonly models: ReadonlyArray<{
      readonly slug: string;
      readonly isDefault?: boolean | undefined;
    }>;
  },
  fallback: ModelSelection | null,
): ModelSelection {
  const model =
    providerSnapshot.models.find((candidate) => candidate.isDefault)?.slug ??
    providerSnapshot.models[0]?.slug ??
    fallback?.model ??
    "default";
  return { instanceId, model };
}

interface ScannedCandidate {
  readonly candidate: ThreadImportCandidate;
  readonly instance: ImportCapableProviderInstance;
  readonly continuationKey: string;
  readonly archived: boolean;
}

function codexResumeThreadId(resumeCursor: unknown): string | undefined {
  if (resumeCursor === null || typeof resumeCursor !== "object" || Array.isArray(resumeCursor)) {
    return undefined;
  }
  const raw = "threadId" in resumeCursor ? resumeCursor.threadId : undefined;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : undefined;
}

function hasMatchingCodexResumeBinding(
  binding: ProviderRuntimeBinding | undefined,
  input: {
    readonly providerInstanceId: ProviderInstanceId;
    readonly externalThreadId: string;
  },
): boolean {
  return (
    binding?.provider === CODEX_DRIVER &&
    binding.providerInstanceId === input.providerInstanceId &&
    codexResumeThreadId(binding.resumeCursor) === input.externalThreadId
  );
}

export interface ThreadImportServiceShape {
  readonly scan: (
    input: ThreadImportScanInput,
  ) => Effect.Effect<ThreadImportScanResult, ThreadImportError>;
  readonly commit: (
    input: ThreadImportCommitInput,
  ) => Effect.Effect<ThreadImportCommitResult, ThreadImportError>;
}

export class ThreadImportService extends Context.Service<
  ThreadImportService,
  ThreadImportServiceShape
>()("t3/threadImport/ThreadImportService") {}

export const makeThreadImportService = (input: {
  readonly projection: ProjectionSnapshotQuery["Service"];
  readonly engine: OrchestrationEngineService["Service"];
  readonly providerInstances: ProviderInstanceRegistry["Service"];
  readonly providerSessions: ProviderSessionDirectory["Service"];
}): ThreadImportServiceShape => {
  const { projection, engine, providerInstances, providerSessions } = input;

  const readProject = (projectId: ThreadImportScanInput["projectId"]) =>
    projection.getProjectShellById(projectId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.flatMap((project) =>
        project === undefined
          ? Effect.fail(error("project-not-found", `Project '${projectId}' was not found.`))
          : Effect.succeed(project),
      ),
      Effect.mapError(() => error("project-not-found", `Project '${projectId}' was not found.`)),
    );

  const existingThreadIds = () =>
    projection.getSnapshot().pipe(
      Effect.map((snapshot) => new Set(snapshot.threads.map((thread) => String(thread.id)))),
      Effect.mapError(() => error("import-failed", "Existing T3 threads could not be read.")),
    );

  const scanCandidates = (project: OrchestrationProjectShell) =>
    Effect.gen(function* () {
      const instances = canonicalCodexInstances(
        yield* providerInstances.listInstances,
        project.defaultModelSelection?.instanceId,
      );
      if (instances.length === 0) {
        return yield* Effect.fail(
          error("provider-unavailable", "No import-capable Codex provider is configured."),
        );
      }

      const importedIds = yield* existingThreadIds();
      const scanned: ScannedCandidate[] = [];
      let successfulScans = 0;
      let lastScanFailure: { readonly detail: string } | undefined;
      for (const instance of instances) {
        const continuationKey = instance.continuationIdentity.continuationKey;
        const result = yield* Effect.result(
          instance.threadImport.scan({ projectRoot: project.workspaceRoot }),
        );
        if (Result.isFailure(result)) {
          lastScanFailure = result.failure;
          continue;
        }
        successfulScans += 1;

        for (const source of result.success) {
          const candidateId = candidateIdFor({
            continuationKey,
            externalThreadId: source.externalThreadId,
            projectRoot: project.workspaceRoot,
          });
          const threadId = importedThreadId(candidateId);
          const transcriptAlreadyImported = importedIds.has(String(threadId));
          const persistedBinding = transcriptAlreadyImported
            ? yield* providerSessions.getBinding(threadId).pipe(
                Effect.map(Option.getOrUndefined),
                Effect.orElseSucceed(() => undefined),
              )
            : undefined;
          const persistedThread = transcriptAlreadyImported
            ? yield* projection.getThreadShellById(threadId).pipe(
                Effect.map(Option.getOrUndefined),
                Effect.orElseSucceed(() => undefined),
              )
            : undefined;
          const nativeResumeReady =
            !transcriptAlreadyImported ||
            (persistedThread?.modelSelection.instanceId === instance.instanceId &&
              hasMatchingCodexResumeBinding(persistedBinding, {
                providerInstanceId: instance.instanceId,
                externalThreadId: source.externalThreadId,
              }));
          const repairWarnings =
            transcriptAlreadyImported && !nativeResumeReady
              ? [
                  "The transcript is already imported, but native Codex resume state needs repair. Re-import to restore it.",
                ]
              : [];
          scanned.push({
            instance,
            continuationKey,
            archived: source.archived,
            candidate: {
              candidateId,
              providerInstanceId: instance.instanceId,
              externalThreadId: source.externalThreadId,
              title: source.title.slice(0, 96),
              ...(source.preview ? { preview: source.preview } : {}),
              createdAt: source.createdAt as ThreadImportCandidate["createdAt"],
              updatedAt: source.updatedAt as ThreadImportCandidate["updatedAt"],
              archived: source.archived,
              canResume: nativeResumeReady,
              alreadyImported: transcriptAlreadyImported && nativeResumeReady,
              warnings: [...source.warnings, ...repairWarnings],
            },
          });
        }
      }
      if (successfulScans === 0 && lastScanFailure !== undefined) {
        return yield* Effect.fail(error("source-unavailable", lastScanFailure.detail));
      }
      return scanned.toSorted(
        (left, right) =>
          Date.parse(right.candidate.updatedAt) - Date.parse(left.candidate.updatedAt),
      );
    });

  const scan = (request: ThreadImportScanInput) =>
    Effect.gen(function* () {
      const project = yield* readProject(request.projectId);
      const scanned = yield* scanCandidates(project);
      return {
        projectId: request.projectId,
        scannedAt: (yield* nowIso) as ThreadImportScanResult["scannedAt"],
        candidates: scanned.map((entry) => entry.candidate),
      };
    });

  const commit = (request: ThreadImportCommitInput) =>
    Effect.gen(function* () {
      const project = yield* readProject(request.projectId);
      const scanned = yield* scanCandidates(project);
      const byId = new Map(scanned.map((entry) => [String(entry.candidate.candidateId), entry]));
      const importedIds = yield* existingThreadIds();
      const results: ThreadImportItemResult[] = [];

      for (const candidateId of request.candidateIds) {
        const source = byId.get(String(candidateId));
        if (!source) {
          results.push({
            candidateId,
            status: "skipped",
            threadId: null,
            importedMessageCount: 0,
            warnings: [],
            error: "The Codex thread is no longer available for this project.",
          });
          continue;
        }

        const threadId = importedThreadId(candidateId);
        const transcriptAlreadyImported = importedIds.has(String(threadId));
        let existingThread = transcriptAlreadyImported
          ? yield* projection.getThreadShellById(threadId).pipe(
              Effect.map(Option.getOrUndefined),
              Effect.orElseSucceed(() => undefined),
            )
          : undefined;
        if (transcriptAlreadyImported) {
          const persistedBinding = yield* providerSessions.getBinding(threadId).pipe(
            Effect.map(Option.getOrUndefined),
            Effect.orElseSucceed(() => undefined),
          );
          if (
            existingThread?.modelSelection.instanceId === source.instance.instanceId &&
            hasMatchingCodexResumeBinding(persistedBinding, {
              providerInstanceId: source.instance.instanceId,
              externalThreadId: source.candidate.externalThreadId,
            })
          ) {
            results.push({
              candidateId,
              status: "already-imported",
              threadId,
              importedMessageCount: 0,
              warnings: [...source.candidate.warnings],
            });
            continue;
          }
        }

        const transcriptResult = yield* Effect.result(
          source.instance.threadImport.read({
            projectRoot: project.workspaceRoot,
            externalThreadId: source.candidate.externalThreadId,
            archived: source.archived,
          }),
        );
        if (Result.isFailure(transcriptResult)) {
          results.push({
            candidateId,
            status: transcriptAlreadyImported ? "transcript-only" : "skipped",
            threadId: transcriptAlreadyImported ? threadId : null,
            importedMessageCount: 0,
            warnings: [...source.candidate.warnings],
            error: transcriptResult.failure.detail,
          });
          continue;
        }

        const transcript = transcriptResult.success;
        const messages = importMessages(candidateId, transcript.messages);
        if (!transcriptAlreadyImported && messages.length === 0) {
          results.push({
            candidateId,
            status: "skipped",
            threadId: null,
            importedMessageCount: 0,
            warnings: [...transcript.warnings],
            error: "The Codex thread contains no readable user or assistant messages.",
          });
          continue;
        }

        const existingModelSelection =
          existingThread?.modelSelection.instanceId === source.instance.instanceId
            ? existingThread.modelSelection
            : undefined;
        const modelSelection =
          existingModelSelection ??
          modelSelectionFor(
            source.instance.instanceId,
            yield* source.instance.snapshot.getSnapshot,
            project.defaultModelSelection,
          );
        const runtimeMode = existingThread?.runtimeMode ?? request.runtimeMode;
        let materializedBeforeBinding = transcriptAlreadyImported;

        if (!transcriptAlreadyImported) {
          const dispatchResult = yield* Effect.result(
            engine.dispatch({
              type: "thread.import",
              commandId: CommandId.make(`import:${String(candidateId)}`),
              threadId,
              projectId: request.projectId,
              title: transcript.title.slice(0, 96),
              modelSelection,
              runtimeMode: request.runtimeMode,
              interactionMode: request.interactionMode,
              messages,
              createdAt: transcript.createdAt,
              updatedAt: transcript.updatedAt,
            }),
          );
          if (Result.isFailure(dispatchResult)) {
            const concurrentThread = yield* projection.getThreadShellById(threadId).pipe(
              Effect.map(Option.getOrUndefined),
              Effect.orElseSucceed(() => undefined),
            );
            if (concurrentThread === undefined) {
              results.push({
                candidateId,
                status: "failed",
                threadId: null,
                importedMessageCount: 0,
                warnings: [...transcript.warnings],
                error: "T3 could not materialize the imported thread.",
              });
              continue;
            }
            existingThread = concurrentThread;
            materializedBeforeBinding = true;
          }
        }

        if (
          materializedBeforeBinding &&
          existingThread !== undefined &&
          existingThread.modelSelection.instanceId !== source.instance.instanceId
        ) {
          const repairTimestamp = yield* nowIso;
          const metadataRepairResult = yield* Effect.result(
            engine.dispatch({
              type: "thread.meta.update",
              commandId: CommandId.make(
                `import-provider-repair:${stableHash(
                  `${String(candidateId)}\0${repairTimestamp}`,
                ).slice(0, 40)}`,
              ),
              threadId,
              modelSelection,
            }),
          );
          if (Result.isFailure(metadataRepairResult)) {
            results.push({
              candidateId,
              status: "transcript-only",
              threadId,
              importedMessageCount: 0,
              warnings: [...transcript.warnings],
              error:
                "The transcript is already imported, but its Codex provider instance could not be restored.",
            });
            continue;
          }
          existingThread = { ...existingThread, modelSelection };
        }

        let status: ThreadImportItemResult["status"] = materializedBeforeBinding
          ? "already-imported"
          : "imported";
        const bindingResult = yield* Effect.result(
          providerSessions.upsert({
            threadId,
            provider: CODEX_DRIVER,
            providerInstanceId: source.instance.instanceId,
            status: "stopped",
            resumeCursor: transcript.resumeCursor,
            runtimeMode: existingThread?.runtimeMode ?? runtimeMode,
            runtimePayload: {
              cwd: transcript.sourceCwd,
              modelSelection,
            },
          }),
        );
        const warnings = [...transcript.warnings];
        if (Result.isFailure(bindingResult)) {
          status = "transcript-only";
          warnings.push(
            materializedBeforeBinding
              ? "The transcript is already imported, but native Codex resume state could not be restored."
              : "The transcript was imported, but native Codex resume state could not be saved.",
          );
        } else if (materializedBeforeBinding) {
          warnings.push(
            "Native Codex resume state was restored without duplicating the transcript.",
          );
        }

        results.push({
          candidateId,
          status,
          threadId,
          importedMessageCount: materializedBeforeBinding ? 0 : messages.length,
          warnings,
        });
        importedIds.add(String(threadId));
      }

      return { projectId: request.projectId, results } satisfies ThreadImportCommitResult;
    });

  return {
    scan: (request) => scan(request).pipe(Effect.mapError(mapThreadImportError)),
    commit: (request) => commit(request).pipe(Effect.mapError(mapThreadImportError)),
  };
};

const mapThreadImportError = (cause: unknown): ThreadImportError =>
  isThreadImportError(cause)
    ? cause
    : error("import-failed", cause instanceof Error ? cause.message : "Thread import failed.");
