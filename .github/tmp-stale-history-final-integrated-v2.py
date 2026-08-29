from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "packages/contracts/src/threadImports.ts",
    '  "transcript-only",\n  "failed",',
    '  "transcript-only",\n  "skipped",\n  "failed",',
)

replace_once(
    "apps/server/src/threadImport/ThreadImportService.ts",
    '''            status: "failed",\n            threadId: null,\n            importedMessageCount: 0,\n            warnings: [],\n            error: "The Codex thread is no longer available for this project.",''',
    '''            status: "skipped",\n            threadId: null,\n            importedMessageCount: 0,\n            warnings: [],\n            error: "The Codex thread is no longer available for this project.",''',
)
replace_once(
    "apps/server/src/threadImport/ThreadImportService.ts",
    '            status: transcriptAlreadyImported ? "transcript-only" : "failed",',
    '            status: transcriptAlreadyImported ? "transcript-only" : "skipped",',
)
replace_once(
    "apps/server/src/threadImport/ThreadImportService.ts",
    '''            status: "failed",\n            threadId: null,\n            importedMessageCount: 0,\n            warnings: [...transcript.warnings],\n            error: "The Codex thread contains no readable user or assistant messages.",''',
    '''            status: "skipped",\n            threadId: null,\n            importedMessageCount: 0,\n            warnings: [...transcript.warnings],\n            error: "The Codex thread contains no readable user or assistant messages.",''',
)

replace_once(
    "apps/server/src/threadImport/ThreadImportService.test.ts",
    '        expect(result.results.map((item) => item.status)).toEqual(["failed", "imported"]);',
    '        expect(result.results.map((item) => item.status)).toEqual(["skipped", "imported"]);',
)
insert_anchor = '''  it.effect(\n    "prefers the project's configured Codex instance when several accounts share one history store",'''
empty_test = '''  it.effect("skips empty Codex transcripts without reporting a product failure", () =>\n    Effect.gen(function* () {\n      const harness = makeHarness({\n        candidates: [sourceCandidate()],\n        read: () => Effect.succeed(sourceTranscript({ messages: [] })),\n      });\n      const scan = yield* harness.service.scan({ projectId });\n      const result = yield* harness.service.commit({\n        projectId,\n        candidateIds: [scan.candidates[0]!.candidateId],\n        runtimeMode: "full-access",\n        interactionMode: "default",\n      });\n\n      expect(result.results[0]).toMatchObject({\n        status: "skipped",\n        importedMessageCount: 0,\n      });\n      expect(result.results[0]?.error).toContain("no readable user or assistant messages");\n      expect(harness.commands).toHaveLength(0);\n    }),\n  );\n\n'''
replace_once(
    "apps/server/src/threadImport/ThreadImportService.test.ts",
    insert_anchor,
    empty_test + insert_anchor,
)

replace_once(
    "apps/web/src/components/CommandPalette.logic.ts",
    '    readonly status: "imported" | "already-imported" | "transcript-only" | "failed";',
    '    readonly status: "imported" | "already-imported" | "transcript-only" | "skipped" | "failed";',
)
replace_once(
    "apps/web/src/components/CommandPalette.logic.ts",
    '''      case "already-imported":\n        alreadyImportedCount += 1;\n        break;\n      case "failed":''',
    '''      case "already-imported":\n        alreadyImportedCount += 1;\n        break;\n      case "skipped":\n        break;\n      case "failed":''',
)

replace_once(
    "apps/web/src/components/CommandPalette.logic.test.ts",
    '  it("summarizes successful, degraded, duplicate, and failed imports", () => {',
    '  it("summarizes successful, degraded, skipped, duplicate, and failed imports", () => {',
)
replace_once(
    "apps/web/src/components/CommandPalette.logic.test.ts",
    '''        { status: "already-imported" },\n        { status: "failed" },''',
    '''        { status: "already-imported" },\n        { status: "skipped" },\n        { status: "failed" },''',
)

replace_once(
    "apps/web/src/components/ThreadImportDialog.tsx",
    '''    case "transcript-only":\n      return `Imported ${result.importedMessageCount} message${result.importedMessageCount === 1 ? "" : "s"}; resume unavailable`;\n    case "failed":''',
    '''    case "transcript-only":\n      return `Imported ${result.importedMessageCount} message${result.importedMessageCount === 1 ? "" : "s"}; resume unavailable`;\n    case "skipped":\n      return result.error ? `Skipped — ${result.error}` : "Skipped";\n    case "failed":''',
)
replace_once(
    "apps/web/src/components/ThreadImportDialog.tsx",
    ''': result.status === "transcript-only"\n                              ? "text-amber-700 dark:text-amber-400"\n                              : "text-emerald-700 dark:text-emerald-400"''',
    ''': result.status === "transcript-only"\n                              ? "text-amber-700 dark:text-amber-400"\n                              : result.status === "skipped"\n                                ? "text-muted-foreground"\n                                : "text-emerald-700 dark:text-emerald-400"''',
)
