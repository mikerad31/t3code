from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one replacement target, found {count}\nTARGET:\n{old}")
    p.write_text(text.replace(old, new))


# ---------------------------------------------------------------------------
# Web: keep imported native-resume routing canonical unless the user explicitly
# changes provider/model during the current visit to the thread.
# ---------------------------------------------------------------------------
replace_once(
    "apps/web/src/components/ChatView.logic.ts",
    "export function buildLocalDraftThread(\n",
    '''/**
 * Imported provider conversations carry an exact provider-instance binding.
 * Their deterministic T3 thread ids can resurrect stale browser-local composer
 * state from an earlier import. Until the user explicitly changes provider in
 * the current thread visit, the persisted server-thread instance is canonical.
 */
export function resolveImportedThreadProviderRouting(input: {
  threadId: ThreadId | null;
  persistedThreadInstanceId: ProviderInstanceId | null | undefined;
  draftActiveProvider: ProviderInstanceId | null | undefined;
  sessionProviderInstanceId: ProviderInstanceId | null | undefined;
  explicitlySelectedForThread: boolean;
}): {
  draftActiveProvider: ProviderInstanceId | null;
  sessionProviderInstanceId: ProviderInstanceId | null;
} {
  const draftActiveProvider = input.draftActiveProvider ?? null;
  const sessionProviderInstanceId = input.sessionProviderInstanceId ?? null;
  const persistedThreadInstanceId = input.persistedThreadInstanceId ?? null;
  const isImportedThread =
    input.threadId !== null && String(input.threadId).startsWith("imported:");

  if (!isImportedThread || persistedThreadInstanceId === null || input.explicitlySelectedForThread) {
    return { draftActiveProvider, sessionProviderInstanceId };
  }

  return {
    draftActiveProvider:
      draftActiveProvider !== null && draftActiveProvider !== persistedThreadInstanceId
        ? null
        : draftActiveProvider,
    sessionProviderInstanceId:
      sessionProviderInstanceId !== null &&
      sessionProviderInstanceId !== persistedThreadInstanceId
        ? null
        : sessionProviderInstanceId,
  };
}

export function buildLocalDraftThread(
''',
)

replace_once(
    "apps/web/src/components/ChatView.logic.test.ts",
    "  resolveDraftPromotionNavigationTarget,\n  resolveThreadMetadataUpdateForNextTurn,\n",
    "  resolveDraftPromotionNavigationTarget,\n  resolveImportedThreadProviderRouting,\n  resolveThreadMetadataUpdateForNextTurn,\n",
)

replace_once(
    "apps/web/src/components/ChatView.logic.test.ts",
    'describe("buildThreadTurnInterruptInput", () => {',
    '''describe("resolveImportedThreadProviderRouting", () => {
  const importedThreadId = ThreadId.make("imported:resume-test");
  const sourceInstanceId = ProviderInstanceId.make("codex_a2");
  const staleInstanceId = ProviderInstanceId.make("codex");

  it("ignores stale draft and session instance drift for an imported thread", () => {
    expect(
      resolveImportedThreadProviderRouting({
        threadId: importedThreadId,
        persistedThreadInstanceId: sourceInstanceId,
        draftActiveProvider: staleInstanceId,
        sessionProviderInstanceId: staleInstanceId,
        explicitlySelectedForThread: false,
      }),
    ).toEqual({
      draftActiveProvider: null,
      sessionProviderInstanceId: null,
    });
  });

  it("honors a provider change explicitly selected during the current thread visit", () => {
    expect(
      resolveImportedThreadProviderRouting({
        threadId: importedThreadId,
        persistedThreadInstanceId: sourceInstanceId,
        draftActiveProvider: staleInstanceId,
        sessionProviderInstanceId: sourceInstanceId,
        explicitlySelectedForThread: true,
      }),
    ).toEqual({
      draftActiveProvider: staleInstanceId,
      sessionProviderInstanceId: sourceInstanceId,
    });
  });

  it("leaves ordinary server-thread routing unchanged", () => {
    expect(
      resolveImportedThreadProviderRouting({
        threadId,
        persistedThreadInstanceId: sourceInstanceId,
        draftActiveProvider: staleInstanceId,
        sessionProviderInstanceId: staleInstanceId,
        explicitlySelectedForThread: false,
      }),
    ).toEqual({
      draftActiveProvider: staleInstanceId,
      sessionProviderInstanceId: staleInstanceId,
    });
  });
});

describe("buildThreadTurnInterruptInput", () => {''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    'import { deriveComposerSendState, readFileAsDataUrl } from "../ChatView.logic";',
    '''import {
  deriveComposerSendState,
  readFileAsDataUrl,
  resolveImportedThreadProviderRouting,
} from "../ChatView.logic";''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''  const composerDraft = useComposerThreadDraft(composerDraftTarget);
  const prompt = composerDraft.prompt;''',
    '''  const composerDraft = useComposerThreadDraft(composerDraftTarget);
  const providerSelectionTouchedThreadIdRef = useRef<ThreadId | null>(null);
  const prompt = composerDraft.prompt;''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''  const selectedProviderByThreadId = composerDraft.activeProvider ?? null;
  const threadProvider =
    activeThread?.session?.providerInstanceId ??
    activeThreadModelSelection?.instanceId ??
    activeProjectDefaultModelSelection?.instanceId ??
    null;''',
    '''  const importedThreadProviderRouting = resolveImportedThreadProviderRouting({
    threadId: activeThreadId,
    persistedThreadInstanceId: activeThreadModelSelection?.instanceId,
    draftActiveProvider: composerDraft.activeProvider,
    sessionProviderInstanceId: activeThread?.session?.providerInstanceId,
    explicitlySelectedForThread:
      activeThreadId !== null && providerSelectionTouchedThreadIdRef.current === activeThreadId,
  });
  const selectedProviderByThreadId = importedThreadProviderRouting.draftActiveProvider;
  const threadProvider =
    importedThreadProviderRouting.sessionProviderInstanceId ??
    activeThreadModelSelection?.instanceId ??
    activeProjectDefaultModelSelection?.instanceId ??
    null;''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''    const lockedInstanceId =
      activeThread.session?.providerInstanceId ?? activeThreadModelSelection?.instanceId;''',
    '''    const lockedInstanceId =
      importedThreadProviderRouting.sessionProviderInstanceId ?? activeThreadModelSelection?.instanceId;''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''    activeThread,
    activeThreadModelSelection?.instanceId,
    lockedProvider,
    providerInstanceEntries,
  ]);''',
    '''    activeThread,
    activeThreadModelSelection?.instanceId,
    importedThreadProviderRouting.sessionProviderInstanceId,
    lockedProvider,
    providerInstanceEntries,
  ]);''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''    const candidates: Array<string | null | undefined> = [
      composerDraft.activeProvider,
      activeThread?.session?.providerInstanceId,
      activeThreadModelSelection?.instanceId,
      activeProjectDefaultModelSelection?.instanceId,
    ];''',
    '''    const candidates: Array<string | null | undefined> = [
      importedThreadProviderRouting.draftActiveProvider,
      importedThreadProviderRouting.sessionProviderInstanceId,
      activeThreadModelSelection?.instanceId,
      activeProjectDefaultModelSelection?.instanceId,
    ];''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''    activeProjectDefaultModelSelection?.instanceId,
    activeThread?.session?.providerInstanceId,
    activeThreadModelSelection?.instanceId,
    composerDraft.activeProvider,
    lockedContinuationGroupKey,
    lockedProvider,
    providerInstanceEntries,
    requestedDriverKind,
  ]);''',
    '''    activeProjectDefaultModelSelection?.instanceId,
    activeThreadModelSelection?.instanceId,
    importedThreadProviderRouting.draftActiveProvider,
    importedThreadProviderRouting.sessionProviderInstanceId,
    lockedContinuationGroupKey,
    lockedProvider,
    providerInstanceEntries,
    requestedDriverKind,
  ]);''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''  const selectedModelForPicker = selectedModel;
  // Instance-keyed option list so the picker can show each configured''',
    '''  const handleProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      providerSelectionTouchedThreadIdRef.current = activeThreadId;
      onProviderModelSelect(instanceId, model);
    },
    [activeThreadId, onProviderModelSelect],
  );
  const selectedModelForPicker = selectedModel;
  // Instance-keyed option list so the picker can show each configured''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''  useEffect(() => {
    setIsTasksDrawerOpen(false);
  }, [activeThreadId]);''',
    '''  useEffect(() => {
    providerSelectionTouchedThreadIdRef.current = null;
    setIsTasksDrawerOpen(false);
  }, [activeThreadId]);''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    "onInstanceModelChange={onProviderModelSelect}",
    "onInstanceModelChange={handleProviderModelSelect}",
)

# ---------------------------------------------------------------------------
# Server: native-resume readiness includes the imported thread's exact provider
# instance, and re-import repairs both routing metadata and the runtime binding.
# ---------------------------------------------------------------------------
replace_once(
    "apps/server/src/threadImport/ThreadImportService.ts",
    '''          const persistedBinding = transcriptAlreadyImported
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
            });''',
    '''          const persistedBinding = transcriptAlreadyImported
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
              }));''',
)

replace_once(
    "apps/server/src/threadImport/ThreadImportService.ts",
    '''          if (
            hasMatchingCodexResumeBinding(persistedBinding, {
              providerInstanceId: source.instance.instanceId,
              externalThreadId: source.candidate.externalThreadId,
            })
          ) {''',
    '''          if (
            existingThread?.modelSelection.instanceId === source.instance.instanceId &&
            hasMatchingCodexResumeBinding(persistedBinding, {
              providerInstanceId: source.instance.instanceId,
              externalThreadId: source.candidate.externalThreadId,
            })
          ) {''',
)

replace_once(
    "apps/server/src/threadImport/ThreadImportService.ts",
    '''        const modelSelection =
          existingThread !== undefined
            ? existingThread.modelSelection
            : modelSelectionFor(
                source.instance.instanceId,
                yield* source.instance.snapshot.getSnapshot,
                project.defaultModelSelection,
              );''',
    '''        const existingModelSelection =
          existingThread?.modelSelection.instanceId === source.instance.instanceId
            ? existingThread.modelSelection
            : undefined;
        const modelSelection =
          existingModelSelection ??
          modelSelectionFor(
            source.instance.instanceId,
            yield* source.instance.snapshot.getSnapshot,
            project.defaultModelSelection,
          );''',
)

replace_once(
    "apps/server/src/threadImport/ThreadImportService.ts",
    '''        let status: ThreadImportItemResult["status"] = materializedBeforeBinding
          ? "already-imported"
          : "imported";
        const bindingResult = yield* Effect.result(''',
    '''        if (
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
                  `${String(candidateId)}\\0${repairTimestamp}`,
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
        const bindingResult = yield* Effect.result(''',
)

replace_once(
    "apps/server/src/threadImport/ThreadImportService.ts",
    "              modelSelection: existingThread?.modelSelection ?? modelSelection,",
    "              modelSelection,",
)

# ---------------------------------------------------------------------------
# Server regression harness and repair test.
# ---------------------------------------------------------------------------
replace_once(
    "apps/server/src/threadImport/ThreadImportService.test.ts",
    '''      if (command.type === "thread.import") {
        importedThread = {
          id: command.threadId,
          projectId: command.projectId,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
        } as OrchestrationThreadShell;
      }
      return Effect.succeed({ sequence: commands.length });''',
    '''      if (command.type === "thread.import") {
        importedThread = {
          id: command.threadId,
          projectId: command.projectId,
          modelSelection: command.modelSelection,
          runtimeMode: command.runtimeMode,
        } as OrchestrationThreadShell;
      } else if (
        command.type === "thread.meta.update" &&
        command.modelSelection !== undefined &&
        importedThread !== null
      ) {
        importedThread = { ...importedThread, modelSelection: command.modelSelection };
      }
      return Effect.succeed({ sequence: commands.length });''',
)

replace_once(
    "apps/server/src/threadImport/ThreadImportService.test.ts",
    '''    commands,
    bindings,
  };
}''',
    '''    commands,
    bindings,
    setImportedModelSelection: (modelSelection: OrchestrationThreadShell["modelSelection"]) => {
      if (importedThread === null) throw new Error("expected an imported thread");
      importedThread = { ...importedThread, modelSelection };
    },
  };
}''',
)

replace_once(
    "apps/server/src/threadImport/ThreadImportService.test.ts",
    '  it.effect("surfaces a total Codex scan failure instead of reporting empty history", () =>',
    '''  it.effect("repairs provider-instance drift before restoring native resume state", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        candidates: [sourceCandidate()],
        read: () => Effect.succeed(sourceTranscript()),
      });
      const initialScan = yield* harness.service.scan({ projectId });
      const candidateId = initialScan.candidates[0]!.candidateId;
      yield* harness.service.commit({
        projectId,
        candidateIds: [candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      });

      const driftedInstanceId = ProviderInstanceId.make("codex");
      harness.setImportedModelSelection({
        instanceId: driftedInstanceId,
        model: "gpt-5.6-luna",
      });
      harness.bindings[0] = {
        ...harness.bindings[0]!,
        providerInstanceId: driftedInstanceId,
        resumeCursor: { threadId: "newly-started-thread" },
      };

      const repairScan = yield* harness.service.scan({ projectId });
      expect(repairScan.candidates[0]).toMatchObject({
        candidateId,
        alreadyImported: false,
        canResume: false,
      });

      const repairCommit = yield* harness.service.commit({
        projectId,
        candidateIds: [candidateId],
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      expect(repairCommit.results[0]?.status).toBe("already-imported");
      expect(harness.commands.map((command) => command.type)).toEqual([
        "thread.import",
        "thread.meta.update",
      ]);
      const metadataRepair = harness.commands[1]!;
      expect(metadataRepair.type).toBe("thread.meta.update");
      if (metadataRepair.type !== "thread.meta.update") {
        throw new Error("expected thread.meta.update repair command");
      }
      expect(metadataRepair.modelSelection).toMatchObject({
        instanceId,
        model: "gpt-5.6-codex",
      });

      const repairedBinding = harness.bindings.at(-1);
      expect(repairedBinding).toMatchObject({
        providerInstanceId: instanceId,
        resumeCursor: sourceTranscript().resumeCursor,
        runtimePayload: {
          modelSelection: {
            instanceId,
            model: "gpt-5.6-codex",
          },
        },
      });

      const repairedScan = yield* harness.service.scan({ projectId });
      expect(repairedScan.candidates[0]).toMatchObject({
        candidateId,
        alreadyImported: true,
        canResume: true,
      });
    }),
  );

  it.effect("surfaces a total Codex scan failure instead of reporting empty history", () =>''',
)

print("native-resume routing repair patch applied")
