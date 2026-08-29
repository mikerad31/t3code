from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(
            f"{path}: expected {expected} matches, found {count}\n--- needle ---\n{old}"
        )
    p.write_text(text.replace(old, new), encoding="utf-8")


# exactOptionalPropertyTypes: never persist an explicitly undefined runtimeMode.
replace_exact(
    "apps/server/src/provider/Layers/ProviderService.ts",
    '            runtimeMode: binding.runtimeMode,\n',
    '            ...(binding.runtimeMode !== undefined ? { runtimeMode: binding.runtimeMode } : {}),\n',
)

# The fake adapter must expose the adapter's real error channel so failure-path
# handoff tests can install a one-shot ProviderAdapterRequestError.
replace_exact(
    "apps/server/src/provider/Layers/ProviderService.test.ts",
    '''  const startSession = vi.fn((input: ProviderSessionStartInput) =>\n    Effect.sync(() => {\n''',
    '''  const startSession = vi.fn(\n    (input: ProviderSessionStartInput): Effect.Effect<ProviderSession, ProviderAdapterError> =>\n      Effect.sync(() => {\n''',
)
replace_exact(
    "apps/server/src/provider/Layers/ProviderService.test.ts",
    '''      return session;\n    }),\n  );\n\n  const sendTurn = vi.fn(\n''',
    '''        return session;\n      }),\n  );\n\n  const sendTurn = vi.fn(\n''',
)

# ProviderServiceShape intentionally keeps reconcileSessionBinding mandatory.
# Unrelated harnesses therefore provide an identity implementation rather than
# weakening the production lifecycle contract just to satisfy structural mocks.
identity = 'reconcileSessionBinding: (_binding, afterBindingCommit) => afterBindingCommit,'

replace_exact(
    "apps/server/integration/orphanedProviderSessionStartup.integration.test.ts",
    '''    stopSession: () => Effect.die("unused"),\n    listSessions: () => Effect.succeed([]),\n''',
    f'''    stopSession: () => Effect.die("unused"),\n    {identity}\n    listSessions: () => Effect.succeed([]),\n''',
)

replace_exact(
    "apps/server/src/orchestration/Layers/CheckpointReactor.test.ts",
    '''    stopSession: () => unsupported(),\n    listSessions,\n''',
    f'''    stopSession: () => unsupported(),\n    {identity}\n    listSessions,\n''',
)

replace_exact(
    "apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts",
    '''      stopSession: stopSession as ProviderServiceShape["stopSession"],\n      listSessions: () => Effect.succeed(runtimeSessions),\n''',
    f'''      stopSession: stopSession as ProviderServiceShape["stopSession"],\n      {identity}\n      listSessions: () => Effect.succeed(runtimeSessions),\n''',
)

replace_exact(
    "apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts",
    '''    stopSession: () => unsupported(),\n    listSessions: () => Effect.succeed([...runtimeSessions]),\n''',
    f'''    stopSession: () => unsupported(),\n    {identity}\n    listSessions: () => Effect.succeed([...runtimeSessions]),\n''',
)

replace_exact(
    "apps/server/src/provider/Layers/ProviderSessionReaper.test.ts",
    '''      stopSession,\n      listSessions: () => Effect.succeed([]),\n''',
    f'''      stopSession,\n      {identity}\n      listSessions: () => Effect.succeed([]),\n''',
)

replace_exact(
    "apps/server/src/serverRuntimeStartup.reconcile.test.ts",
    '''    stopSession: () => Effect.die("unused"),\n    listSessions: () => Effect.succeed(liveThreadIds.map((threadId) => ({ threadId }) as never)),\n''',
    f'''    stopSession: () => Effect.die("unused"),\n    {identity}\n    listSessions: () => Effect.succeed(liveThreadIds.map((threadId) => ({{ threadId }}) as never)),\n''',
)

print("provider handoff v2 typecheck repair applied")
