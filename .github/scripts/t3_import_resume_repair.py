from pathlib import Path


def replace_once(path_str: str, old: str, new: str, label: str) -> None:
    path = Path(path_str)
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


SERVICE = "apps/server/src/threadImport/ThreadImportService.ts"
TEST = "apps/server/src/threadImport/ThreadImportService.test.ts"

replace_once(
    SERVICE,
    'import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";',
    '''import {
  type ProviderRuntimeBinding,
  ProviderSessionDirectory,
} from "../provider/Services/ProviderSessionDirectory.ts";''',
    "provider runtime binding import",
)

replace_once(
    SERVICE,
    '''interface ScannedCandidate {
  readonly candidate: ThreadImportCandidate;
  readonly instance: ImportCapableProviderInstance;
  readonly continuationKey: string;
  readonly archived: boolean;
}

export interface ThreadImportServiceShape {''',
    '''interface ScannedCandidate {
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

export interface ThreadImportServiceShape {''',
    "resume binding matcher",
)

replace_once(
    SERVICE,
    '''          const candidateId = candidateIdFor({
            continuationKey,
            externalThreadId: source.externalThreadId,
            projectRoot: project.workspaceRoot,
          });
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
              canResume: true,
              alreadyImported: importedIds.has(String(importedThreadId(candidateId))),
              warnings: [...source.warnings],
            },
          });''',
    '''          const candidateId = candidateIdFor({
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
          const nativeResumeReady =
            !transcriptAlreadyImported ||
            hasMatchingCodexResumeBinding(persistedBinding, {
              providerInstanceId: instance.instanceId,
              externalThreadId: source.externalThreadId,
            });
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
          });''',
    "scan imported binding health",
)

replace_once(
    SERVICE,
    '''        const threadId = importedThreadId(candidateId);
        if (importedIds.has(String(threadId))) {
          results.push({
            candidateId,
            status: "already-imported",
            threadId,
            importedMessageCount: 0,
            warnings: [...source.candidate.warnings],
          });
          continue;
        }

        const transcriptResult = yield* Effect.result(''',
    '''        const threadId = importedThreadId(candidateId);
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

        const transcriptResult = yield* Effect.result(''',
    "commit repair preflight",
)

replace_once(
    SERVICE,
    '''        if (Result.isFailure(transcriptResult)) {
          results.push({
            candidateId,
            status: "failed",
            threadId: null,
            importedMessageCount: 0,
            warnings: [...source.candidate.warnings],
            error: transcriptResult.failure.detail,
          });
          continue;
        }

        const transcript = transcriptResult.success;
        const messages = importMessages(candidateId, transcript.messages);
        if (messages.length === 0) {''',
    '''        if (Result.isFailure(transcriptResult)) {
          results.push({
            candidateId,
            status: transcriptAlreadyImported ? "transcript-only" : "failed",
            threadId: transcriptAlreadyImported ? threadId : null,
            importedMessageCount: 0,
            warnings: [...source.candidate.warnings],
            error: transcriptResult.failure.detail,
          });
          continue;
        }

        const transcript = transcriptResult.success;
        const messages = importMessages(candidateId, transcript.messages);
        if (!transcriptAlreadyImported && messages.length === 0) {''',
    "repair read failure semantics",
)

replace_once(
    SERVICE,
    '''        const snapshot = yield* source.instance.snapshot.getSnapshot;
        const modelSelection = modelSelectionFor(
          source.instance.instanceId,
          snapshot,
          project.defaultModelSelection,
        );
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
          const existing = yield* projection.getThreadShellById(threadId).pipe(
            Effect.map(Option.isSome),
            Effect.orElseSucceed(() => false),
          );
          results.push(
            existing
              ? {
                  candidateId,
                  status: "already-imported",
                  threadId,
                  importedMessageCount: messages.length,
                  warnings: [...transcript.warnings],
                }
              : {
                  candidateId,
                  status: "failed",
                  threadId: null,
                  importedMessageCount: 0,
                  warnings: [...transcript.warnings],
                  error: "T3 could not materialize the imported thread.",
                },
          );
          continue;
        }

        let status: ThreadImportItemResult["status"] = "imported";
        const bindingResult = yield* Effect.result(
          providerSessions.upsert({
            threadId,
            provider: CODEX_DRIVER,
            providerInstanceId: source.instance.instanceId,
            status: "stopped",
            resumeCursor: transcript.resumeCursor,
            runtimeMode: request.runtimeMode,
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
            "The transcript was imported, but native Codex resume state could not be saved.",
          );
        }

        results.push({
          candidateId,
          status,
          threadId,
          importedMessageCount: messages.length,
          warnings,
        });
        importedIds.add(String(threadId));''',
    '''        const modelSelection =
          existingThread !== undefined
            ? existingThread.modelSelection
            : modelSelectionFor(
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
              modelSelection: existingThread?.modelSelection ?? modelSelection,
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
          warnings.push("Native Codex resume state was restored without duplicating the transcript.");
        }

        results.push({
          candidateId,
          status,
          threadId,
          importedMessageCount: materializedBeforeBinding ? 0 : messages.length,
          warnings,
        });
        importedIds.add(String(threadId));''',
    "repair existing transcript binding without redispatch",
)

replace_once(
    TEST,
    '''function makeHarness(options: {
  readonly candidates: ReadonlyArray<ProviderThreadImportCandidate>;
  readonly read: ProviderThreadImportShape["read"];
  readonly sessionUpsert?: ProviderSessionDirectory["Service"]["upsert"];
}) {''',
    '''function makeHarness(options: {
  readonly candidates: ReadonlyArray<ProviderThreadImportCandidate>;
  readonly scan?: ProviderThreadImportShape["scan"];
  readonly read: ProviderThreadImportShape["read"];
  readonly sessionUpsert?: ProviderSessionDirectory["Service"]["upsert"];
}) {''',
    "test harness scan override",
)

replace_once(
    TEST,
    '''        importedThread = {
          id: command.threadId,
          projectId: command.projectId,
        } as OrchestrationThreadShell;''',
    '''        importedThread = {
          id: command.threadId,
          projectId: command.projectId,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
        } as OrchestrationThreadShell;''',
    "realistic imported thread shell",
)

replace_once(
    TEST,
    '''  const provider = makeProvider({
    scan: () => Effect.succeed(options.candidates),
    read: options.read,
  });''',
    '''  const provider = makeProvider({
    scan: options.scan ?? (() => Effect.succeed(options.candidates)),
    read: options.read,
  });''',
    "test provider scan override",
)

replace_once(
    TEST,
    '''  const providerSessions = {
    upsert:
      options.sessionUpsert ??
      ((binding: ProviderRuntimeBinding) => {
        bindings.push(binding);
        return Effect.void;
      }),
    getProvider: () => Effect.die("not used by thread import tests"),
    getBinding: () => Effect.succeed(Option.none()),
    listThreadIds: () => Effect.succeed([]),
    listBindings: () => Effect.succeed([]),
  } as ProviderSessionDirectory["Service"];''',
    '''  const providerSessions = {
    upsert: (binding: ProviderRuntimeBinding) =>
      (options.sessionUpsert?.(binding) ?? Effect.void).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            bindings.push(binding);
          }),
        ),
      ),
    getProvider: () => Effect.die("not used by thread import tests"),
    getBinding: (threadId: OrchestrationThreadShell["id"]) =>
      Effect.succeed(
        Option.fromNullable(
          bindings.findLast((binding) => String(binding.threadId) === String(threadId)),
        ),
      ),
    listThreadIds: () => Effect.succeed([]),
    listBindings: () => Effect.succeed([]),
  } as ProviderSessionDirectory["Service"];''',
    "persist test bindings for lookup",
)

replace_once(
    TEST,
    '''  it("isolates transcript read failures so another selected conversation can still import", async () => {''',
    '''  it("repairs missing native resume state on retry without duplicating the transcript", async () => {
    let rejectBinding = true;
    const harness = makeHarness({
      candidates: [sourceCandidate()],
      read: () => Effect.succeed(sourceTranscript()),
      sessionUpsert: () =>
        rejectBinding
          ? Effect.fail(
              new ProviderValidationError({
                operation: "thread-import-resume-binding",
                issue: "simulated persistence rejection",
              }),
            )
          : Effect.void,
    });

    const initialScan = await Effect.runPromise(harness.service.scan({ projectId }));
    const candidateId = initialScan.candidates[0]!.candidateId;
    const firstCommit = await Effect.runPromise(
      harness.service.commit({
        projectId,
        candidateIds: [candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      }),
    );
    expect(firstCommit.results[0]?.status).toBe("transcript-only");
    expect(harness.commands).toHaveLength(1);
    expect(harness.bindings).toHaveLength(0);

    const repairScan = await Effect.runPromise(harness.service.scan({ projectId }));
    expect(repairScan.candidates[0]).toMatchObject({
      candidateId,
      alreadyImported: false,
      canResume: false,
    });
    expect(repairScan.candidates[0]?.warnings.join(" ")).toContain("needs repair");

    rejectBinding = false;
    const repairCommit = await Effect.runPromise(
      harness.service.commit({
        projectId,
        candidateIds: [candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      }),
    );
    expect(repairCommit.results[0]?.status).toBe("already-imported");
    expect(repairCommit.results[0]?.importedMessageCount).toBe(0);
    expect(repairCommit.results[0]?.warnings.join(" ")).toContain("was restored");
    expect(harness.commands).toHaveLength(1);
    expect(harness.bindings).toHaveLength(1);

    const repairedScan = await Effect.runPromise(harness.service.scan({ projectId }));
    expect(repairedScan.candidates[0]).toMatchObject({
      candidateId,
      alreadyImported: true,
      canResume: true,
    });
  });

  it("surfaces a total Codex scan failure instead of reporting empty history", async () => {
    const harness = makeHarness({
      candidates: [],
      scan: () =>
        Effect.fail(
          new ProviderThreadImportError({
            operation: "scan",
            detail: "simulated Codex history scan failure",
          }),
        ),
      read: () => Effect.succeed(sourceTranscript()),
    });

    await expect(Effect.runPromise(harness.service.scan({ projectId }))).rejects.toMatchObject({
      code: "source-unavailable",
      message: "simulated Codex history scan failure",
    });
  });

  it("isolates transcript read failures so another selected conversation can still import", async () => {''',
    "resume repair and scan failure regression tests",
)
