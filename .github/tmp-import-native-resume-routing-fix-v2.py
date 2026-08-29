from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one replacement target, found {count}\nTARGET:\n{old}")
    p.write_text(text.replace(old, new))


replace_once(
    "apps/web/src/components/ChatView.logic.ts",
    '''export function resolveImportedThreadProviderRouting(input: {
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

  if (
    !isImportedThread ||
    persistedThreadInstanceId === null ||
    input.explicitlySelectedForThread
  ) {
    return { draftActiveProvider, sessionProviderInstanceId };
  }

  return {
    draftActiveProvider:
      draftActiveProvider !== null && draftActiveProvider !== persistedThreadInstanceId
        ? null
        : draftActiveProvider,
    sessionProviderInstanceId:
      sessionProviderInstanceId !== null && sessionProviderInstanceId !== persistedThreadInstanceId
        ? null
        : sessionProviderInstanceId,
  };
}
''',
    '''export function resolveImportedThreadProviderRouting(input: {
  threadId: ThreadId | null;
  persistedThreadInstanceId: ProviderInstanceId | null | undefined;
  draftActiveProvider: ProviderInstanceId | null | undefined;
  sessionProviderInstanceId: ProviderInstanceId | null | undefined;
  explicitlySelectedProviderInstanceId: ProviderInstanceId | null | undefined;
}): {
  draftActiveProvider: ProviderInstanceId | null;
  sessionProviderInstanceId: ProviderInstanceId | null;
} {
  const draftActiveProvider = input.draftActiveProvider ?? null;
  const sessionProviderInstanceId = input.sessionProviderInstanceId ?? null;
  const persistedThreadInstanceId = input.persistedThreadInstanceId ?? null;
  const explicitlySelectedProviderInstanceId = input.explicitlySelectedProviderInstanceId ?? null;
  const isImportedThread =
    input.threadId !== null && String(input.threadId).startsWith("imported:");

  if (!isImportedThread || persistedThreadInstanceId === null) {
    return { draftActiveProvider, sessionProviderInstanceId };
  }

  const providerIsAllowed = (instanceId: ProviderInstanceId | null): boolean =>
    instanceId === null ||
    instanceId === persistedThreadInstanceId ||
    instanceId === explicitlySelectedProviderInstanceId;

  return {
    draftActiveProvider: providerIsAllowed(draftActiveProvider) ? draftActiveProvider : null,
    sessionProviderInstanceId: providerIsAllowed(sessionProviderInstanceId)
      ? sessionProviderInstanceId
      : null,
  };
}
''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''  const composerDraft = useComposerThreadDraft(composerDraftTarget);
  const providerSelectionTouchedThreadIdRef = useRef<ThreadId | null>(null);
  const prompt = composerDraft.prompt;''',
    '''  const composerDraft = useComposerThreadDraft(composerDraftTarget);
  const explicitlySelectedProviderInstanceRef = useRef<{
    readonly threadId: ThreadId;
    readonly instanceId: ProviderInstanceId;
  } | null>(null);
  const prompt = composerDraft.prompt;''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''    sessionProviderInstanceId: activeThread?.session?.providerInstanceId,
    explicitlySelectedForThread:
      activeThreadId !== null && providerSelectionTouchedThreadIdRef.current === activeThreadId,
  });''',
    '''    sessionProviderInstanceId: activeThread?.session?.providerInstanceId,
    explicitlySelectedProviderInstanceId:
      activeThreadId !== null &&
      explicitlySelectedProviderInstanceRef.current?.threadId === activeThreadId
        ? explicitlySelectedProviderInstanceRef.current.instanceId
        : null,
  });''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''  const handleProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      providerSelectionTouchedThreadIdRef.current = activeThreadId;
      onProviderModelSelect(instanceId, model);
    },
    [activeThreadId, onProviderModelSelect],
  );''',
    '''  const handleProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      explicitlySelectedProviderInstanceRef.current =
        activeThreadId === null ? null : { threadId: activeThreadId, instanceId };
      onProviderModelSelect(instanceId, model);
    },
    [activeThreadId, onProviderModelSelect],
  );''',
)

replace_once(
    "apps/web/src/components/chat/ChatComposer.tsx",
    '''  useEffect(() => {
    providerSelectionTouchedThreadIdRef.current = null;
    setIsTasksDrawerOpen(false);
  }, [activeThreadId]);''',
    '''  useEffect(() => {
    explicitlySelectedProviderInstanceRef.current = null;
    setIsTasksDrawerOpen(false);
  }, [activeThreadId]);''',
)

replace_once(
    "apps/web/src/components/ChatView.logic.test.ts",
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
});''',
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
        explicitlySelectedProviderInstanceId: null,
      }),
    ).toEqual({
      draftActiveProvider: null,
      sessionProviderInstanceId: null,
    });
  });

  it("does not unlock stale provider drift after a model-only selection on the source instance", () => {
    expect(
      resolveImportedThreadProviderRouting({
        threadId: importedThreadId,
        persistedThreadInstanceId: sourceInstanceId,
        draftActiveProvider: staleInstanceId,
        sessionProviderInstanceId: staleInstanceId,
        explicitlySelectedProviderInstanceId: sourceInstanceId,
      }),
    ).toEqual({
      draftActiveProvider: null,
      sessionProviderInstanceId: null,
    });
  });

  it("honors an explicitly selected different provider instance during the current thread visit", () => {
    expect(
      resolveImportedThreadProviderRouting({
        threadId: importedThreadId,
        persistedThreadInstanceId: sourceInstanceId,
        draftActiveProvider: staleInstanceId,
        sessionProviderInstanceId: sourceInstanceId,
        explicitlySelectedProviderInstanceId: staleInstanceId,
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
        explicitlySelectedProviderInstanceId: null,
      }),
    ).toEqual({
      draftActiveProvider: staleInstanceId,
      sessionProviderInstanceId: staleInstanceId,
    });
  });
});''',
)
