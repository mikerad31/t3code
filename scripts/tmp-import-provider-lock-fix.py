from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} anchor(s), found {count}")
    p.write_text(text.replace(old, new), encoding="utf-8")


replace_exact(
    "apps/web/src/components/ChatView.logic.ts",
    '''  type ModelSelection,
  type ProviderDriverKind,
  type ServerProvider,''',
    '''  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,''',
)

replace_exact(
    "apps/web/src/components/ChatView.logic.ts",
    '''// `threadProvider` is the open branded driver kind carried by the session.
// Unknown driver kinds degrade to `null` (i.e. "unlocked"), which is the safe
// rollback / fork behavior — the routing layer is the right place to surface
// "driver not installed" errors, not the lock state.
//
// `selectedProvider` takes the same open-string shape because the composer
// now tracks the picker selection as a `ProviderInstanceId` (e.g.
// `codex_personal`). Custom instance ids that don't directly match a
// registered driver resolve to `null` here, which matches the existing
// "unknown driver -> unlocked" semantics. Callers that want the lock to track
// a custom instance's underlying driver kind should resolve the instance id
// upstream and pass the correlated kind.
export function deriveLockedProvider(input: {
  thread: Thread | null | undefined;
  selectedProvider: string | null;
  threadProvider: string | null;
}): ProviderDriverKind | null {
  if (!threadHasStarted(input.thread)) {
    return null;
  }
  const sessionProvider = input.thread?.session?.providerName ?? null;
  if (sessionProvider && isProviderDriverKind(sessionProvider)) {
    return sessionProvider;
  }
  const narrowedThreadProvider =
    input.threadProvider && isProviderDriverKind(input.threadProvider)
      ? input.threadProvider
      : null;
  const narrowedSelectedProvider =
    input.selectedProvider && isProviderDriverKind(input.selectedProvider)
      ? input.selectedProvider
      : null;
  return narrowedThreadProvider ?? narrowedSelectedProvider ?? null;
}''',
    '''// Started threads are locked to their provider DRIVER kind, while model
// selections store a provider INSTANCE id. A custom instance slug is allowed
// to look exactly like a driver slug, so syntax validation cannot distinguish
// the two. Resolve instance ids through the environment's live provider
// snapshots instead of re-branding the instance id as a driver kind.
export function deriveLockedProvider(input: {
  thread: Thread | null | undefined;
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver">>;
  selectedProvider: ProviderInstanceId | null;
  threadProvider: ProviderInstanceId | null;
}): ProviderDriverKind | null {
  if (!threadHasStarted(input.thread)) {
    return null;
  }
  const sessionProvider = input.thread?.session?.providerName ?? null;
  if (sessionProvider && isProviderDriverKind(sessionProvider)) {
    return sessionProvider;
  }
  const resolveDriverKind = (instanceId: ProviderInstanceId | null): ProviderDriverKind | null =>
    instanceId === null
      ? null
      : (input.providers.find((provider) => provider.instanceId === instanceId)?.driver ?? null);
  return resolveDriverKind(input.threadProvider) ?? resolveDriverKind(input.selectedProvider);
}''',
)

replace_exact(
    "apps/web/src/components/ChatView.tsx",
    '''  const selectedProviderByThreadId = composerActiveProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;
  const lockedProvider = deriveLockedProvider({
    thread: activeThread,
    selectedProvider: selectedProviderByThreadId,
    threadProvider,
  });
  // Once a thread selects an environment, never substitute the primary
  // environment's config while the selected environment is still loading.
  const serverConfig = activeThread
    ? (activeEnvironment?.serverConfig ?? null)
    : (primaryEnvironment?.serverConfig ?? null);''',
    '''  const selectedProviderByThreadId = composerActiveProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;
  // Once a thread selects an environment, never substitute the primary
  // environment's config while the selected environment is still loading.
  const serverConfig = activeThread
    ? (activeEnvironment?.serverConfig ?? null)
    : (primaryEnvironment?.serverConfig ?? null);
  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS;
  const lockedProvider = deriveLockedProvider({
    thread: activeThread,
    providers: providerStatuses,
    selectedProvider: selectedProviderByThreadId,
    threadProvider,
  });''',
)

replace_exact(
    "apps/web/src/components/ChatView.tsx",
    '''  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS;
  const unlockedSelectedProvider = resolveSelectableProvider(''',
    '''  const unlockedSelectedProvider = resolveSelectableProvider(''',
)

replace_exact(
    "apps/web/src/components/ChatView.logic.test.ts",
    '''  MessageId,
  ProjectId,
  ProviderInstanceId,''',
    '''  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,''',
)

replace_exact(
    "apps/web/src/components/ChatView.logic.test.ts",
    '''  createLocalDispatchSnapshot,
  deriveComposerSendState,
  dismissBranchMismatchForSession,''',
    '''  createLocalDispatchSnapshot,
  deriveComposerSendState,
  deriveLockedProvider,
  dismissBranchMismatchForSession,''',
)

replace_exact(
    "apps/web/src/components/ChatView.logic.test.ts",
    '''const readySession = {
  threadId,
  status: "ready" as const,
  providerName: "codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeMode: "full-access" as const,
  activeTurnId: null,
  lastError: null,
  updatedAt: "2026-03-29T00:00:10.000Z",
};

describe("buildLoadingThreadFromShell", () => {''',
    '''const readySession = {
  threadId,
  status: "ready" as const,
  providerName: "codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeMode: "full-access" as const,
  activeTurnId: null,
  lastError: null,
  updatedAt: "2026-03-29T00:00:10.000Z",
};

describe("deriveLockedProvider", () => {
  it("resolves a pure imported custom instance to its registered driver kind", () => {
    const importedInstanceId = ProviderInstanceId.make("codex_a1");
    const codexDriver = ProviderDriverKind.make("codex");

    expect(
      deriveLockedProvider({
        thread: makeThread({
          modelSelection: {
            instanceId: importedInstanceId,
            model: "gpt-5.6-codex",
          },
          latestTurn: completedTurn,
          session: null,
        }),
        providers: [{ instanceId: importedInstanceId, driver: codexDriver }],
        selectedProvider: null,
        threadProvider: importedInstanceId,
      }),
    ).toBe(codexDriver);
  });
});

describe("buildLoadingThreadFromShell", () => {''',
)

print("Applied imported-thread provider lock fix and regression coverage.")
