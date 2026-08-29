from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}\n--- needle ---\n{old[:500]}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


provider = "apps/server/src/provider/Layers/ProviderService.ts"

replace_once(
    provider,
    '''  const getAdapterEntries = Ref.get(subscribedAdapters).pipe(\n    Effect.map((map) => Array.from(map.entries())),\n  );\n''',
    '''  const getAdapterEntries = Ref.get(subscribedAdapters).pipe(\n    Effect.map((map) => Array.from(map.entries())),\n  );\n\n  // Provider adapters such as Codex own a native single-writer conversation.\n  // Serialize lifecycle changes per T3 thread so two sends/provider switches can\n  // never establish competing writers for the same conversation.\n  const threadHandoffLocks = new Map<string, Effect.Semaphore>();\n  const getThreadHandoffLock = Effect.fn("getThreadHandoffLock")(function* (threadId: ThreadId) {\n    const key = String(threadId);\n    const existing = threadHandoffLocks.get(key);\n    if (existing) return existing;\n\n    const created = yield* Effect.makeSemaphore(1);\n    // `makeSemaphore` may yield; if another fiber won the race, share its lock.\n    const raced = threadHandoffLocks.get(key);\n    if (raced) return raced;\n    threadHandoffLocks.set(key, created);\n    return created;\n  });\n  const withThreadHandoffLock = <A, E, R>(\n    threadId: ThreadId,\n    effect: Effect.Effect<A, E, R>,\n  ): Effect.Effect<A, E, R> =>\n    Effect.flatMap(getThreadHandoffLock(threadId), (lock) => lock.withPermits(1)(effect));\n\n  const listLiveSessionsForThread = Effect.fn("listLiveSessionsForThread")(function* (\n    threadId: ThreadId,\n  ) {\n    const currentAdapters = yield* getAdapterEntries;\n    const sessions = yield* Effect.forEach(currentAdapters, ([instanceId, adapter]) =>\n      adapter.listSessions().pipe(\n        Effect.map((adapterSessions) =>\n          adapterSessions\n            .filter((session) => session.threadId === threadId)\n            .map((session) => ({\n              instanceId,\n              adapter,\n              session: { ...session, providerInstanceId: instanceId },\n            })),\n        ),\n      ),\n    );\n    return sessions.flat();\n  });\n''',
)

old_stop = '''  const stopStaleSessionsForThread = Effect.fn("stopStaleSessionsForThread")(function* (input: {\n    readonly threadId: ThreadId;\n    readonly currentInstanceId: ProviderInstanceId;\n  }) {\n    const currentAdapters = yield* getAdapterEntries;\n    yield* Effect.forEach(\n      currentAdapters,\n      ([instanceId, adapter]) =>\n        instanceId === input.currentInstanceId\n          ? Effect.void\n          : Effect.gen(function* () {\n              const hasSession = yield* adapter.hasSession(input.threadId);\n              if (!hasSession) {\n                return;\n              }\n\n              yield* adapter.stopSession(input.threadId).pipe(\n                Effect.tap(() =>\n                  analytics.record("provider.session.stopped", {\n                    provider: adapter.provider,\n                  }),\n                ),\n                Effect.catchCause((cause) =>\n                  Effect.logWarning("provider.session.stop-stale-failed", {\n                    threadId: input.threadId,\n                    provider: adapter.provider,\n                    cause,\n                  }),\n                ),\n              );\n            }),\n      { discard: true },\n    );\n  });\n'''
new_stop = '''  const stopStaleSessionsForThread = Effect.fn("stopStaleSessionsForThread")(function* (input: {\n    readonly threadId: ThreadId;\n    readonly currentInstanceId?: ProviderInstanceId;\n    readonly desiredInstanceId?: ProviderInstanceId;\n  }) {\n    const currentAdapters = yield* getAdapterEntries;\n    yield* Effect.forEach(\n      currentAdapters,\n      ([instanceId, adapter]) =>\n        instanceId === input.currentInstanceId\n          ? Effect.void\n          : Effect.gen(function* () {\n              const hasSession = yield* adapter.hasSession(input.threadId);\n              if (!hasSession) return;\n\n              yield* Effect.logInfo("provider.thread-handoff", {\n                threadId: input.threadId,\n                oldInstance: instanceId,\n                newInstance: input.desiredInstanceId ?? input.currentInstanceId ?? null,\n                phase: "stop-old",\n              });\n              yield* adapter.stopSession(input.threadId);\n              if (yield* adapter.hasSession(input.threadId)) {\n                return yield* toValidationError(\n                  "ProviderService.stopStaleSessionsForThread",\n                  `Provider instance '${instanceId}' still owns thread '${input.threadId}' after stop completed.`,\n                );\n              }\n              yield* analytics.record("provider.session.stopped", { provider: adapter.provider });\n              yield* Effect.logInfo("provider.thread-handoff", {\n                threadId: input.threadId,\n                oldInstance: instanceId,\n                newInstance: input.desiredInstanceId ?? input.currentInstanceId ?? null,\n                phase: "old-released",\n              });\n            }),\n      { discard: true },\n    );\n  });\n'''
replace_once(provider, old_stop, new_stop)

replace_once(
    provider,
    '''      const adapter = yield* registry.getByInstance(bindingInstanceId);\n      const hasResumeCursor =\n''',
    '''      const adapter = yield* registry.getByInstance(bindingInstanceId);\n      // A persisted binding may have been repaired while another configured\n      // instance still has this T3 thread live. Release that stale writer\n      // before adopting/resuming the persisted provider.\n      yield* stopStaleSessionsForThread({\n        threadId: input.binding.threadId,\n        currentInstanceId: bindingInstanceId,\n        desiredInstanceId: bindingInstanceId,\n      });\n      const hasResumeCursor =\n''',
)

# startSession: serialize and choose cursor with stale-live reconciliation before start.
text = Path(provider).read_text(encoding="utf-8")
start_pos = text.index('  const startSession: ProviderServiceMethod<"startSession">')
send_pos = text.index('  const sendTurn: ProviderServiceMethod<"sendTurn">', start_pos)
segment = text[start_pos:send_pos]
segment = segment.replace(
    '      return yield* Effect.gen(function* () {\n',
    '      return yield* withThreadHandoffLock(threadId, Effect.gen(function* () {\n',
    1,
)
segment = segment.replace(
    '''        const persistedBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));\n        const effectiveResumeCursor =\n          input.resumeCursor ??\n          (persistedBinding?.providerInstanceId === resolvedInstanceId\n            ? persistedBinding.resumeCursor\n            : undefined);\n''',
    '''        const persistedBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));\n        const liveSessions = yield* listLiveSessionsForThread(threadId);\n        const liveOtherSessions = liveSessions.filter(\n          (live) => live.instanceId !== resolvedInstanceId,\n        );\n        const persistedTargetsDesired = persistedBinding?.providerInstanceId === resolvedInstanceId;\n        // If persistence already names the requested provider but a different\n        // provider is live, persistence is the repaired/canonical continuation.\n        // Never let the stale live provider's cursor overwrite it. For a normal\n        // provider switch, the request/live cursor carries the conversation.\n        const effectiveResumeCursor =\n          persistedTargetsDesired && liveOtherSessions.length > 0\n            ? persistedBinding?.resumeCursor\n            : (input.resumeCursor ??\n              (persistedTargetsDesired\n                ? persistedBinding?.resumeCursor\n                : liveOtherSessions.find((live) => live.session.resumeCursor !== undefined)?.session\n                    .resumeCursor));\n''',
    1,
)
segment = segment.replace(
    '''        const adapter = yield* registry.getByInstance(resolvedInstanceId);\n        yield* prepareMcpSession(threadId, resolvedInstanceId);\n''',
    '''        const adapter = yield* registry.getByInstance(resolvedInstanceId);\n        if (liveOtherSessions.length > 0) {\n          yield* Effect.logInfo("provider.thread-handoff", {\n            threadId,\n            nativeThread:\n              effectiveResumeCursor &&\n              typeof effectiveResumeCursor === "object" &&\n              !Array.isArray(effectiveResumeCursor) &&\n              "threadId" in effectiveResumeCursor\n                ? String(effectiveResumeCursor.threadId)\n                : null,\n            oldInstance: liveOtherSessions[0]?.instanceId ?? null,\n            newInstance: resolvedInstanceId,\n            phase: "reconcile",\n          });\n          yield* stopStaleSessionsForThread({\n            threadId,\n            currentInstanceId: resolvedInstanceId,\n            desiredInstanceId: resolvedInstanceId,\n          });\n        }\n        yield* Effect.logInfo("provider.thread-handoff", {\n          threadId,\n          oldInstance: liveOtherSessions[0]?.instanceId ?? null,\n          newInstance: resolvedInstanceId,\n          phase: "start-new",\n        });\n        yield* prepareMcpSession(threadId, resolvedInstanceId);\n''',
    1,
)
segment = segment.replace(
    '''        yield* stopStaleSessionsForThread({\n          threadId,\n          currentInstanceId: resolvedInstanceId,\n        });\n        yield* upsertSessionBinding(sessionWithInstance, threadId, {\n''',
    '''        yield* upsertSessionBinding(sessionWithInstance, threadId, {\n''',
    1,
)
# close withThreadHandoffLock around the existing metrics-wrapped effect.
needle = '''      ).pipe(\n        withMetrics({\n          counter: providerSessionsTotal,\n          attributes: () =>\n            providerMetricAttributes(metricProvider, {\n              operation: "start",\n            }),\n        }),\n      );\n'''
replacement = '''      ).pipe(\n        withMetrics({\n          counter: providerSessionsTotal,\n          attributes: () =>\n            providerMetricAttributes(metricProvider, {\n              operation: "start",\n            }),\n        }),\n      ));\n'''
if segment.count(needle) != 1:
    raise SystemExit("ProviderService startSession metrics tail drifted")
segment = segment.replace(needle, replacement, 1)
text = text[:start_pos] + segment + text[send_pos:]
Path(provider).write_text(text, encoding="utf-8")

# sendTurn: serialize routing/send so it cannot race a provider handoff.
text = Path(provider).read_text(encoding="utf-8")
send_pos = text.index('  const sendTurn: ProviderServiceMethod<"sendTurn">')
interrupt_pos = text.index('  const interruptTurn:', send_pos)
segment = text[send_pos:interrupt_pos]
segment = segment.replace(
    '    return yield* Effect.gen(function* () {\n',
    '    return yield* withThreadHandoffLock(input.threadId, Effect.gen(function* () {\n',
    1,
)
needle = '''    }).pipe(\n      withMetrics({\n        counter: providerTurnsTotal,\n        timer: providerTurnDuration,\n        attributes: () =>\n          providerTurnMetricAttributes({\n            provider: metricProvider,\n            model: metricModel,\n            extra: {\n              operation: "send",\n            },\n          }),\n      }),\n    );\n'''
replacement = '''    }).pipe(\n      withMetrics({\n        counter: providerTurnsTotal,\n        timer: providerTurnDuration,\n        attributes: () =>\n          providerTurnMetricAttributes({\n            provider: metricProvider,\n            model: metricModel,\n            extra: {\n              operation: "send",\n            },\n          }),\n      }),\n    ));\n'''
if segment.count(needle) != 1:
    raise SystemExit("ProviderService sendTurn metrics tail drifted")
segment = segment.replace(needle, replacement, 1)
text = text[:send_pos] + segment + text[interrupt_pos:]
Path(provider).write_text(text, encoding="utf-8")

# stopSession: stop every live adapter for this thread, not only the persisted one.
text = Path(provider).read_text(encoding="utf-8")
stop_pos = text.index('  const stopSession: ProviderServiceMethod<"stopSession">')
list_pos = text.index('  const listSessions:', stop_pos)
segment = text[stop_pos:list_pos]
body_start = segment.index('      let metricProvider = "unknown";')
body_end = segment.index('\n    },\n  );', body_start)
old_body = segment[body_start:body_end]
new_body = '''      let metricProvider = "unknown";\n      return yield* withThreadHandoffLock(input.threadId, Effect.gen(function* () {\n        const binding = Option.getOrUndefined(yield* directory.getBinding(input.threadId));\n        if (binding) metricProvider = binding.provider;\n        yield* Effect.annotateCurrentSpan({\n          "provider.operation": "stop-session",\n          "provider.kind": binding?.provider ?? "unknown",\n          "provider.thread_id": input.threadId,\n        });\n        yield* stopStaleSessionsForThread({ threadId: input.threadId });\n        yield* clearMcpSession(input.threadId);\n        if (binding) {\n          const bindingInstanceId = yield* requireBindingInstanceId(\n            "ProviderService.stopSession",\n            binding,\n          );\n          yield* directory.upsert({\n            threadId: input.threadId,\n            provider: binding.provider,\n            providerInstanceId: bindingInstanceId,\n            status: "stopped",\n            runtimeMode: binding.runtimeMode,\n            ...(binding.resumeCursor !== undefined ? { resumeCursor: binding.resumeCursor } : {}),\n            runtimePayload: { activeTurnId: null },\n          });\n          yield* analytics.record("provider.session.stopped", { provider: binding.provider });\n        }\n      }).pipe(\n        withMetrics({\n          counter: providerSessionsTotal,\n          outcomeAttributes: () =>\n            providerMetricAttributes(metricProvider, {\n              operation: "stop",\n            }),\n        }),\n      ));'''
segment = segment[:body_start] + new_body + segment[body_end:]
text = text[:stop_pos] + segment + text[list_pos:]
Path(provider).write_text(text, encoding="utf-8")

# listSessions: stale live/persisted mismatch is diagnostic state, not a fatal defect.
replace_once(
    provider,
    '''        overrides.providerInstanceId = dieOnMissingBindingInstanceId(\n          "ProviderService.listSessions",\n          binding,\n        );\n        if (binding.provider !== session.provider) {\n          return yield* Effect.die(\n            new Error(\n              `ProviderService.listSessions: thread '${session.threadId}' is active on provider '${session.provider}' but persisted binding names provider '${binding.provider}'.`,\n            ),\n          );\n        }\n        if (overrides.providerInstanceId !== session.providerInstanceId) {\n          return yield* Effect.die(\n            new Error(\n              `ProviderService.listSessions: thread '${session.threadId}' is active on provider instance '${session.providerInstanceId}' but persisted binding names '${overrides.providerInstanceId}'.`,\n            ),\n          );\n        }\n''',
    '''        const bindingInstanceId = binding.providerInstanceId;\n        if (\n          binding.provider !== session.provider ||\n          bindingInstanceId === undefined ||\n          bindingInstanceId !== session.providerInstanceId\n        ) {\n          yield* Effect.logWarning("provider.session.binding-mismatch", {\n            threadId: session.threadId,\n            liveProvider: session.provider,\n            liveInstanceId: session.providerInstanceId ?? null,\n            persistedProvider: binding.provider,\n            persistedInstanceId: bindingInstanceId ?? null,\n          });\n          // Report the live session truthfully. The next explicit start/send for\n          // this thread performs the serialized reconciliation; listSessions is\n          // observational and must never strand the user by throwing.\n          sessions.push(session);\n          continue;\n        }\n        overrides.providerInstanceId = bindingInstanceId;\n''',
)

# Reactor: ProviderService owns stop-old -> start-new ordering and cursor selection.
reactor = "apps/server/src/orchestration/Layers/ProviderCommandReactor.ts"
replace_once(
    reactor,
    '''      if (instanceChanged) {\n        yield* providerService.stopSession({ threadId });\n      }\n      const restartedSession = yield* startProviderSession(\n''',
    '''      const restartedSession = yield* startProviderSession(\n''',
)

# Import repair: use the lifecycle service before changing persisted metadata/binding.
thread_import = "apps/server/src/threadImport/ThreadImportService.ts"
replace_once(
    thread_import,
    '''import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";\nimport {\n''',
    '''import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";\nimport { ProviderService } from "../provider/Services/ProviderService.ts";\nimport {\n''',
)
replace_once(
    thread_import,
    '''  readonly providerInstances: ProviderInstanceRegistry["Service"];\n  readonly providerSessions: ProviderSessionDirectory["Service"];\n}): ThreadImportServiceShape => {\n  const { projection, engine, providerInstances, providerSessions } = input;\n''',
    '''  readonly providerInstances: ProviderInstanceRegistry["Service"];\n  readonly providerSessions: ProviderSessionDirectory["Service"];\n  readonly providerService: ProviderService["Service"];\n}): ThreadImportServiceShape => {\n  const { projection, engine, providerInstances, providerSessions, providerService } = input;\n''',
)
replace_once(
    thread_import,
    '''        if (\n          materializedBeforeBinding &&\n          existingThread !== undefined &&\n          existingThread.modelSelection.instanceId !== source.instance.instanceId\n        ) {\n''',
    '''        if (materializedBeforeBinding) {\n          const stopResult = yield* Effect.result(providerService.stopSession({ threadId }));\n          if (Result.isFailure(stopResult)) {\n            results.push({\n              candidateId,\n              status: "transcript-only",\n              threadId,\n              importedMessageCount: 0,\n              warnings: [...transcript.warnings],\n              error:\n                "The transcript is already imported, but its live provider session could not be released before restoring native Codex resume state.",\n            });\n            continue;\n          }\n        }\n\n        if (\n          materializedBeforeBinding &&\n          existingThread !== undefined &&\n          existingThread.modelSelection.instanceId !== source.instance.instanceId\n        ) {\n''',
)

# WS already has providerService in scope at construction time.
ws = "apps/server/src/ws.ts"
replace_once(
    ws,
    '''        providerInstances,\n        providerSessions,\n      });\n''',
    '''        providerInstances,\n        providerSessions,\n        providerService,\n      });\n''',
)

print("provider handoff v1 patch applied")
