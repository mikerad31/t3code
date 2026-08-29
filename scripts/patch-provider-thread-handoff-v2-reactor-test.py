from pathlib import Path

p = Path("apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts")
text = p.read_text(encoding="utf-8")
old = '''    expect(harness.stopSession).toHaveBeenCalledTimes(1);\n    expect(harness.stopSession.mock.invocationCallOrder[0]).toBeLessThan(\n      harness.startSession.mock.invocationCallOrder[1]!,\n    );\n'''
new = '''    // ProviderService owns serialized stop-old -> start-new handoff. The reactor\n    // only delegates the replacement start and must not independently stop the\n    // thread, which would split lifecycle ownership and reopen the race.\n    expect(harness.stopSession).toHaveBeenCalledTimes(0);\n'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected exactly one legacy compatible-instance stop assertion, found {count}")
p.write_text(text.replace(old, new, 1), encoding="utf-8")
print("reactor handoff ownership assertion updated")
