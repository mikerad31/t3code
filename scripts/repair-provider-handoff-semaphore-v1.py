from pathlib import Path

path = Path("apps/server/src/provider/Layers/ProviderService.ts")
text = path.read_text(encoding="utf-8")

import_needle = 'import * as Ref from "effect/Ref";\n'
if text.count(import_needle) != 1:
    raise SystemExit("Ref import boundary drifted")
text = text.replace(
    import_needle,
    import_needle + 'import * as Semaphore from "effect/Semaphore";\n',
    1,
)

start_marker = "  const threadHandoffLocks = new Map<string, Effect.Semaphore>();"
end_marker = "\n\n  const listLiveSessionsForThread"
start = text.find(start_marker)
if start < 0:
    raise SystemExit("generated handoff lock start marker not found")
end = text.find(end_marker, start)
if end < 0:
    raise SystemExit("generated handoff lock end marker not found")

replacement = '''  const threadHandoffLocks = new Map<string, Semaphore.Semaphore>();
  const getThreadHandoffLock = (threadId: ThreadId): Semaphore.Semaphore => {
    const key = String(threadId);
    const existing = threadHandoffLocks.get(key);
    if (existing) return existing;

    // Construction is synchronous in Effect v4, so there is no creation race.
    const created = Semaphore.makeUnsafe(1);
    threadHandoffLocks.set(key, created);
    return created;
  };
  const withThreadHandoffLock = <A, E, R>(
    threadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> => getThreadHandoffLock(threadId).withPermit(effect);'''

text = text[:start] + replacement + text[end:]
path.write_text(text, encoding="utf-8")
print("Effect v4 semaphore repair applied")
