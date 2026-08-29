from pathlib import Path

path = Path("apps/server/src/threadImport/ThreadImportService.test.ts")
text = path.read_text()
anchor = '''  it.effect("surfaces a total Codex scan failure instead of reporting empty history", () =>\n'''
if text.count(anchor) != 1:
    raise SystemExit(f"expected one insertion anchor, found {text.count(anchor)}")

test = '''  it.effect("preserves archived source metadata through scan and provider read", () =>\n    Effect.gen(function* () {\n      const externalThreadId = "codex-thread-archived";\n      const archivedCandidate = sourceCandidate({\n        externalThreadId,\n        title: "Archived persisted Codex conversation",\n        archived: true,\n      });\n      const readInputs: Array<Parameters<ProviderThreadImportShape["read"]>[0]> = [];\n      const harness = makeHarness({\n        candidates: [archivedCandidate],\n        read: (input) => {\n          readInputs.push(input);\n          return Effect.succeed(\n            sourceTranscript({\n              externalThreadId,\n              title: archivedCandidate.title,\n              archived: true,\n              resumeCursor: { threadId: externalThreadId },\n            }),\n          );\n        },\n      });\n\n      const scan = yield* harness.service.scan({ projectId });\n      expect(scan.candidates[0]).toMatchObject({\n        externalThreadId,\n        archived: true,\n        canResume: true,\n        alreadyImported: false,\n      });\n\n      const result = yield* harness.service.commit({\n        projectId,\n        candidateIds: [scan.candidates[0]!.candidateId],\n        runtimeMode: "full-access",\n        interactionMode: "default",\n      });\n\n      expect(result.results[0]?.status).toBe("imported");\n      expect(readInputs).toEqual([\n        {\n          projectRoot: project.workspaceRoot,\n          externalThreadId,\n          archived: true,\n        },\n      ]);\n      expect(harness.bindings[0]).toMatchObject({\n        providerInstanceId: instanceId,\n        resumeCursor: { threadId: externalThreadId },\n      });\n    }),\n  );\n\n'''

path.write_text(text.replace(anchor, test + anchor, 1))
