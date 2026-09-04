// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  CommandId,
  MessageId,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  ThreadImportCandidateId,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type ProviderInstanceId,
  type ThreadImportCandidate,
  type ThreadImportCommitInput,
  type ThreadImportCommitResult,
  type ThreadImportItemResult,
  type ThreadBranchBoundariesInput,
  type ThreadBranchBoundariesResult,
  type ThreadBranchInput,
  type ThreadBranchResult,
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
import type {
  ProviderThreadForkSnapshot,
  ProviderThreadSnapshot,
} from "../provider/Services/ProviderAdapter.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
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

function branchThreadId(sourceThreadId: ThreadId, nativeThreadId: string): ThreadId {
  return ThreadId.make(
    `branch:${stableHash(`${String(sourceThreadId)}\0${nativeThreadId}`).slice(0, 48)}`,
  );
}

function branchMessageId(input: {
  readonly nativeThreadId: string;
  readonly turnId: TurnId;
  readonly index: number;
  readonly role: "user" | "assistant";
  readonly text: string;
}): MessageId {
  return MessageId.make(
    `branch-message:${stableHash(
      `${input.nativeThreadId}\0${input.turnId}\0${input.index}\0${input.role}\0${input.text}`,
    ).slice(0, 48)}`,
  );
}

function nativeItemText(
  item: unknown,
): { readonly role: "user" | "assistant"; readonly text: string } | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  if (record.type === "agentMessage" && typeof record.text === "string") {
    const text = record.text.trim();
    return text.length > 0 ? { role: "assistant", text } : null;
  }
  if (record.type !== "userMessage" || !Array.isArray(record.content)) return null;
  const text = record.content
    .flatMap((content) => {
      if (content === null || typeof content !== "object" || Array.isArray(content)) return [];
      const contentRecord = content as Record<string, unknown>;
      return contentRecord.type === "text" && typeof contentRecord.text === "string"
        ? [contentRecord.text]
        : [];
    })
    .join("\n\n")
    .trim();
  return text.length > 0 ? { role: "user", text } : null;
}

function resolveHistoricalBranchBoundaries(
  source: OrchestrationThread,
  native: ProviderThreadSnapshot,
): ReadonlyArray<{ readonly messageId: MessageId; readonly turnId: TurnId }> {
  const projected = source.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      messageId: message.id,
      role: message.role,
      text: message.text.trim(),
      turnId: message.turnId,
    }));
  const nativeMessages = native.turns.flatMap((turn) =>
    turn.items.flatMap((item) => {
      const message = nativeItemText(item);
      return message === null ? [] : [{ ...message, turnId: turn.id }];
    }),
  );
  if (projected.length === 0 || nativeMessages.length === 0) {
    return [];
  }

  // Imported projections can assign one timestamp to every message in a
  // historical turn. ProjectionSnapshotQuery then orders those ties by the
  // imported message id, which is not the native item order. Resolve each
  // row against the native item text instead of requiring a contiguous
  // projection-shaped sequence. A boundary is accepted only when its exact
  // role/text pair occurs once and is not claimed by another projected row;
  // duplicate or missing matches stay hidden for that row.
  const candidates = projected.map((message) =>
    nativeMessages.flatMap((nativeMessage, index) =>
      message.role === nativeMessage.role &&
      message.text === nativeMessage.text &&
      (message.turnId === null || message.turnId === nativeMessage.turnId)
        ? [index]
        : [],
    ),
  );
  const candidateUseCounts = new Map<number, number>();
  for (const matches of candidates) {
    if (matches.length !== 1) continue;
    const match = matches[0]!;
    candidateUseCounts.set(match, (candidateUseCounts.get(match) ?? 0) + 1);
  }
  return projected.flatMap((message, index) => {
    if (message.role !== "assistant" || message.turnId !== null) return [];
    const matches = candidates[index]!;
    if (matches.length !== 1 || candidateUseCounts.get(matches[0]!) !== 1) return [];
    return [{ messageId: message.messageId, turnId: nativeMessages[matches[0]!]!.turnId }];
  });
}

function nativeTimestamp(seconds: number | null, fallback: string): string {
  return seconds !== null && Number.isFinite(seconds)
    ? DateTime.formatIso(DateTime.fromEpochSeconds(seconds))
    : fallback;
}

function branchMessages(
  forked: ProviderThreadForkSnapshot,
  fallbackTimestamp: string,
  lastTurnId: TurnId,
): ReadonlyArray<{
  readonly id: MessageId;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly turnId: TurnId;
}> {
  const boundaryIndex = forked.turns.findIndex((turn) => turn.id === lastTurnId);
  const turns = boundaryIndex < 0 ? [] : forked.turns.slice(0, boundaryIndex + 1);
  return turns.flatMap((turn) => {
    let itemIndex = 0;
    return turn.items.flatMap((item) => {
      const message = nativeItemText(item);
      if (message === null) return [];
      const createdAt = nativeTimestamp(
        message.role === "assistant" ? turn.completedAt : turn.startedAt,
        fallbackTimestamp,
      );
      const result = {
        id: branchMessageId({
          nativeThreadId: forked.threadId,
          turnId: TurnId.make(String(turn.id)),
          index: itemIndex,
          role: message.role,
          text: message.text,
        }),
        role: message.role,
        text: message.text,
        createdAt,
        turnId: TurnId.make(String(turn.id)),
      } as const;
      itemIndex += 1;
      return [result];
    });
  });
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
    readonly continuationKey: string;
    readonly externalThreadId: string;
    readonly instances: ReadonlyArray<ProviderInstance>;
  },
): boolean {
  const boundInstance = input.instances.find(
    (instance) => instance.instanceId === input.providerInstanceId,
  );
  return (
    binding?.provider === CODEX_DRIVER &&
    binding.providerInstanceId === input.providerInstanceId &&
    codexResumeThreadId(binding.resumeCursor) === input.externalThreadId &&
    boundInstance?.driverKind === CODEX_DRIVER &&
    boundInstance.enabled &&
    boundInstance.continuationIdentity.continuationKey === input.continuationKey
  );
}

export interface ThreadImportServiceShape {
  readonly scan: (
    input: ThreadImportScanInput,
  ) => Effect.Effect<ThreadImportScanResult, ThreadImportError>;
  readonly commit: (
    input: ThreadImportCommitInput,
  ) => Effect.Effect<ThreadImportCommitResult, ThreadImportError>;
  readonly branchBoundaries: (
    input: ThreadBranchBoundariesInput,
  ) => Effect.Effect<ThreadBranchBoundariesResult, ThreadImportError>;
  readonly branch: (
    input: ThreadBranchInput,
  ) => Effect.Effect<ThreadBranchResult, ThreadImportError>;
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
  readonly providerService: ProviderService["Service"];
}): ThreadImportServiceShape => {
  const { projection, engine, providerInstances, providerSessions, providerService } = input;

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
      const allInstances = yield* providerInstances.listInstances;
      const instances = canonicalCodexInstances(
        allInstances,
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
            (persistedThread !== undefined &&
              hasMatchingCodexResumeBinding(persistedBinding, {
                providerInstanceId: persistedThread.modelSelection.instanceId,
                continuationKey,
                externalThreadId: source.externalThreadId,
                instances: allInstances,
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
      const allInstances = yield* providerInstances.listInstances;
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
            existingThread !== undefined &&
            hasMatchingCodexResumeBinding(persistedBinding, {
              providerInstanceId: existingThread.modelSelection.instanceId,
              continuationKey: source.continuationKey,
              externalThreadId: source.candidate.externalThreadId,
              instances: allInstances,
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
              settled: source.archived,
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

        const needsMetadataRepair =
          materializedBeforeBinding &&
          existingThread !== undefined &&
          existingThread.modelSelection.instanceId !== source.instance.instanceId;
        const metadataRepair = needsMetadataRepair
          ? Effect.gen(function* () {
              const repairTimestamp = yield* nowIso;
              yield* engine.dispatch({
                type: "thread.meta.update",
                commandId: CommandId.make(
                  `import-provider-repair:${stableHash(
                    `${String(candidateId)}\0${repairTimestamp}`,
                  ).slice(0, 40)}`,
                ),
                threadId,
                modelSelection,
              });
            })
          : Effect.void;

        let status: ThreadImportItemResult["status"] = materializedBeforeBinding
          ? "already-imported"
          : "imported";
        const bindingResult = yield* Effect.result(
          providerService.reconcileSessionBinding(
            {
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
            },
            metadataRepair,
          ),
        );
        if (
          Result.isSuccess(bindingResult) &&
          needsMetadataRepair &&
          existingThread !== undefined
        ) {
          existingThread = { ...existingThread, modelSelection };
        }
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

  const readHistoricalBoundaries = (source: OrchestrationThread) =>
    Effect.gen(function* () {
      const hasHistoricalAssistant = source.messages.some(
        (message) => message.role === "assistant" && message.turnId === null && !message.streaming,
      );
      if (!hasHistoricalAssistant) return [];

      const sourceBinding = Option.getOrUndefined(
        yield* providerSessions
          .getBinding(source.id)
          .pipe(
            Effect.mapError(() =>
              error(
                "provider-unavailable",
                `Native Codex state for '${source.id}' is unavailable.`,
              ),
            ),
          ),
      );
      if (sourceBinding?.provider !== CODEX_DRIVER) {
        return [];
      }

      const providerInstanceId =
        sourceBinding.providerInstanceId ?? source.modelSelection.instanceId;
      const providerInstance = yield* providerInstances.getInstance(providerInstanceId);
      const readNativeThread =
        providerInstance !== undefined && hasThreadImport(providerInstance)
          ? providerInstance.threadImport.readNativeThread
          : undefined;
      const sourceNativeThreadId = codexResumeThreadId(sourceBinding.resumeCursor);
      if (readNativeThread !== undefined && sourceNativeThreadId !== undefined) {
        const project = yield* readProject(source.projectId);
        const native = yield* readNativeThread({
          projectRoot: project.workspaceRoot,
          externalThreadId: sourceNativeThreadId,
        }).pipe(Effect.mapError((cause) => error("provider-unavailable", cause.detail)));
        if (native.threadId !== sourceNativeThreadId) {
          return [];
        }
        return resolveHistoricalBranchBoundaries(source, {
          threadId: ThreadId.make(native.threadId),
          turns: native.turns,
        });
      }
      if (providerService.readThread === undefined) {
        return [];
      }

      const native = yield* providerService
        .readThread({ threadId: source.id })
        .pipe(
          Effect.mapError((cause) =>
            error(
              "provider-unavailable",
              cause instanceof Error
                ? cause.message
                : `Native Codex history for '${source.id}' is unavailable.`,
            ),
          ),
        );
      return resolveHistoricalBranchBoundaries(source, native);
    });

  const branchBoundaries = (request: ThreadBranchBoundariesInput) =>
    Effect.gen(function* () {
      const source = yield* projection.getThreadDetailById(request.threadId).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.mapError(() =>
          error("thread-not-found", `Thread '${request.threadId}' could not be read.`),
        ),
      );
      if (source === undefined) {
        return yield* Effect.fail(
          error("thread-not-found", `Thread '${request.threadId}' could not be read.`),
        );
      }
      return {
        boundaries: yield* readHistoricalBoundaries(source),
      } satisfies ThreadBranchBoundariesResult;
    });

  const branch = (request: ThreadBranchInput) =>
    Effect.gen(function* () {
      const source = yield* projection.getThreadDetailById(request.threadId).pipe(
        Effect.map(Option.getOrUndefined),
        Effect.mapError(() =>
          error("thread-not-found", `Thread '${request.threadId}' could not be read.`),
        ),
      );
      if (source === undefined) {
        return yield* Effect.fail(
          error("thread-not-found", `Thread '${request.threadId}' could not be read.`),
        );
      }

      const selectedAssistant = source.messages.find(
        (message) =>
          message.id === request.messageId && message.role === "assistant" && !message.streaming,
      );
      if (selectedAssistant === undefined || source.latestTurn?.state === "running") {
        return yield* Effect.fail(
          error(
            "turn-not-forkable",
            `Message '${request.messageId}' is not a completed assistant response that can be forked.`,
          ),
        );
      }

      const historicalBoundary =
        selectedAssistant.turnId === null
          ? (yield* readHistoricalBoundaries(source)).find(
              (boundary) => boundary.messageId === selectedAssistant.id,
            )?.turnId
          : selectedAssistant.turnId;
      if (historicalBoundary === undefined || historicalBoundary !== request.lastTurnId) {
        return yield* Effect.fail(
          error(
            "turn-not-forkable",
            `Message '${request.messageId}' does not have a proven native Codex turn boundary.`,
          ),
        );
      }

      const sourceBinding = Option.getOrUndefined(
        yield* providerSessions
          .getBinding(request.threadId)
          .pipe(
            Effect.mapError(() =>
              error(
                "provider-unavailable",
                `Native Codex state for '${request.threadId}' is unavailable.`,
              ),
            ),
          ),
      );
      if (sourceBinding?.provider !== CODEX_DRIVER) {
        return yield* Effect.fail(
          error("provider-unavailable", "Branching is only available for Codex conversations."),
        );
      }
      const sourceNativeThreadId = codexResumeThreadId(sourceBinding.resumeCursor);
      if (sourceNativeThreadId === undefined) {
        return yield* Effect.fail(
          error(
            "provider-unavailable",
            `Native Codex resume state for '${request.threadId}' is unavailable.`,
          ),
        );
      }

      const forkNative = providerService.forkThread;
      if (forkNative === undefined) {
        return yield* Effect.fail(
          error("provider-unavailable", "This server does not support native Codex thread forks."),
        );
      }
      const forked = yield* forkNative({
        threadId: request.threadId,
        lastTurnId: historicalBoundary,
      }).pipe(
        Effect.mapError((cause) =>
          error(
            "fork-failed",
            cause instanceof Error ? cause.message : "Native Codex fork failed.",
          ),
        ),
      );
      if (forked.threadId.trim().length === 0 || forked.threadId === sourceNativeThreadId) {
        return yield* Effect.fail(
          error("fork-failed", "Codex returned the source thread instead of a new fork."),
        );
      }
      if (!forked.turns.some((turn) => turn.id === historicalBoundary)) {
        return yield* Effect.fail(
          error("fork-failed", "Codex fork did not include the selected turn boundary."),
        );
      }

      const timestamp = yield* nowIso;
      const messages = branchMessages(forked, timestamp, historicalBoundary);
      if (messages.length === 0) {
        return yield* Effect.fail(
          error("fork-failed", "Codex fork returned no readable conversation messages."),
        );
      }

      const childThreadId = branchThreadId(request.threadId, forked.threadId);
      // The native fork is the source of truth for continuation. The import
      // command only projects the forked prefix into T3's local conversation
      // view; it never creates or resumes a second native thread itself.
      const command = {
        type: "thread.import" as const,
        commandId: CommandId.make(
          `thread-branch:${stableHash(`${String(request.threadId)}\0${forked.threadId}`).slice(0, 48)}`,
        ),
        threadId: childThreadId,
        projectId: source.projectId,
        title: source.title,
        modelSelection: source.modelSelection,
        runtimeMode: source.runtimeMode,
        interactionMode: source.interactionMode,
        branch: source.branch,
        worktreePath: source.worktreePath,
        messages,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const binding: ProviderRuntimeBinding = {
        threadId: childThreadId,
        provider: CODEX_DRIVER,
        providerInstanceId: sourceBinding.providerInstanceId ?? source.modelSelection.instanceId,
        status: "stopped",
        resumeCursor: { threadId: forked.threadId },
        runtimeMode: source.runtimeMode,
        runtimePayload: {
          cwd: forked.cwd,
          modelSelection: source.modelSelection,
          forkedFromId: forked.forkedFromId,
          reasoningEffort: forked.reasoningEffort,
        },
      };

      yield* providerService
        .reconcileSessionBinding(binding, engine.dispatch(command))
        .pipe(
          Effect.mapError((cause) =>
            error(
              "fork-failed",
              cause instanceof Error ? cause.message : "The branched T3 thread could not be saved.",
            ),
          ),
        );
      return {
        threadId: childThreadId,
        nativeThreadId: forked.threadId,
        forkedFromId: forked.forkedFromId,
      } satisfies ThreadBranchResult;
    });

  return {
    scan: (request) => scan(request).pipe(Effect.mapError(mapThreadImportError)),
    commit: (request) => commit(request).pipe(Effect.mapError(mapThreadImportError)),
    branchBoundaries: (request) =>
      branchBoundaries(request).pipe(Effect.mapError(mapThreadImportError)),
    branch: (request) => branch(request).pipe(Effect.mapError(mapThreadImportError)),
  };
};

const mapThreadImportError = (cause: unknown): ThreadImportError =>
  isThreadImportError(cause)
    ? cause
    : error("import-failed", cause instanceof Error ? cause.message : "Thread import failed.");
