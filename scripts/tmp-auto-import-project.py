from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one anchor, found {count}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


# Pure helpers used by the add-project flow and covered by unit tests.
replace_once(
    "apps/web/src/components/CommandPalette.logic.ts",
    'export const ADDON_ICON_CLASS = "size-4";\n',
    '''export const ADDON_ICON_CLASS = "size-4";\n\nexport function selectNewThreadImportCandidateIds<TId>(\n  candidates: ReadonlyArray<{ readonly candidateId: TId; readonly alreadyImported: boolean }>,\n): TId[] {\n  return candidates\n    .filter((candidate) => !candidate.alreadyImported)\n    .map((candidate) => candidate.candidateId);\n}\n\nexport function summarizeAutoThreadImportResults(\n  results: ReadonlyArray<{\n    readonly status: "imported" | "already-imported" | "transcript-only" | "failed";\n  }>,\n) {\n  let importedCount = 0;\n  let transcriptOnlyCount = 0;\n  let alreadyImportedCount = 0;\n  let failedCount = 0;\n\n  for (const result of results) {\n    switch (result.status) {\n      case "imported":\n        importedCount += 1;\n        break;\n      case "transcript-only":\n        transcriptOnlyCount += 1;\n        break;\n      case "already-imported":\n        alreadyImportedCount += 1;\n        break;\n      case "failed":\n        failedCount += 1;\n        break;\n    }\n  }\n\n  return { importedCount, transcriptOnlyCount, alreadyImportedCount, failedCount };\n}\n''',
)

replace_once(
    "apps/web/src/components/CommandPalette.logic.test.ts",
    '  reduceCommandPaletteUiState,\n  type CommandPaletteGroup,\n',
    '  reduceCommandPaletteUiState,\n  selectNewThreadImportCandidateIds,\n  summarizeAutoThreadImportResults,\n  type CommandPaletteGroup,\n',
)
replace_once(
    "apps/web/src/components/CommandPalette.logic.test.ts",
    'describe("browseInputEndPaddingClass", () => {\n',
    '''describe("automatic project conversation import", () => {\n  it("selects only candidates that are not already imported", () => {\n    expect(\n      selectNewThreadImportCandidateIds([\n        { candidateId: "new-1", alreadyImported: false },\n        { candidateId: "existing", alreadyImported: true },\n        { candidateId: "new-2", alreadyImported: false },\n      ]),\n    ).toEqual(["new-1", "new-2"]);\n  });\n\n  it("summarizes successful, degraded, duplicate, and failed imports", () => {\n    expect(\n      summarizeAutoThreadImportResults([\n        { status: "imported" },\n        { status: "transcript-only" },\n        { status: "already-imported" },\n        { status: "failed" },\n        { status: "imported" },\n      ]),\n    ).toEqual({\n      importedCount: 2,\n      transcriptOnlyCount: 1,\n      alreadyImportedCount: 1,\n      failedCount: 1,\n    });\n  });\n});\n\ndescribe("browseInputEndPaddingClass", () => {\n''',
)

# Wire the existing importer RPCs into the add-project flow.
replace_once(
    "apps/web/src/components/CommandPalette.tsx",
    '  filterPinnedBrowseEntries,\n  getCommandPaletteInputPlaceholder,\n',
    '  filterPinnedBrowseEntries,\n  selectNewThreadImportCandidateIds,\n  summarizeAutoThreadImportResults,\n  getCommandPaletteInputPlaceholder,\n',
)
replace_once(
    "apps/web/src/components/CommandPalette.tsx",
    'import { primaryServerKeybindingsAtom, primaryServerProvidersAtom } from "../state/server";\n',
    '''import {\n  primaryServerKeybindingsAtom,\n  primaryServerProvidersAtom,\n  serverEnvironment,\n} from "../state/server";\n''',
)
replace_once(
    "apps/web/src/components/CommandPalette.tsx",
    '''  const createProject = useAtomCommand(projectEnvironment.create, {\n    reportFailure: false,\n  });\n  const lookupRepository = useAtomQueryRunner(sourceControlEnvironment.repository, {\n''',
    '''  const createProject = useAtomCommand(projectEnvironment.create, {\n    reportFailure: false,\n  });\n  const scanThreadImports = useAtomQueryRunner(serverEnvironment.threadImportScan, {\n    reportFailure: false,\n  });\n  const commitThreadImports = useAtomCommand(serverEnvironment.threadImportCommit, {\n    reportFailure: false,\n  });\n  const lookupRepository = useAtomQueryRunner(sourceControlEnvironment.repository, {\n''',
)
replace_once(
    "apps/web/src/components/CommandPalette.tsx",
    '  const handleAddProjectForEnvironment = useCallback(\n',
    '''  const autoImportCodexHistory = useCallback(\n    async (input: {\n      readonly environmentId: EnvironmentId;\n      readonly projectId: ProjectId;\n      readonly projectTitle: string;\n    }) => {\n      const scanResult = await scanThreadImports({\n        environmentId: input.environmentId,\n        input: { projectId: input.projectId },\n      });\n      if (scanResult._tag === "Failure") {\n        if (!isAtomCommandInterrupted(scanResult)) {\n          const error = squashAtomCommandFailure(scanResult);\n          toastManager.add(\n            stackedThreadToast({\n              type: "warning",\n              title: "Project added; Codex import skipped",\n              description:\n                error instanceof Error\n                  ? error.message\n                  : "Existing Codex conversations could not be scanned.",\n            }),\n          );\n        }\n        return;\n      }\n\n      const candidateIds = selectNewThreadImportCandidateIds(scanResult.value.candidates);\n      if (candidateIds.length === 0) return;\n\n      const commitResult = await commitThreadImports({\n        environmentId: input.environmentId,\n        input: {\n          projectId: input.projectId,\n          candidateIds,\n          runtimeMode: "full-access",\n          interactionMode: "default",\n        },\n      });\n      if (commitResult._tag === "Failure") {\n        if (!isAtomCommandInterrupted(commitResult)) {\n          const error = squashAtomCommandFailure(commitResult);\n          toastManager.add(\n            stackedThreadToast({\n              type: "warning",\n              title: "Project added; Codex import incomplete",\n              description:\n                error instanceof Error\n                  ? error.message\n                  : "Existing Codex conversations could not be imported.",\n            }),\n          );\n        }\n        return;\n      }\n\n      const summary = summarizeAutoThreadImportResults(commitResult.value.results);\n      const importedCount = summary.importedCount + summary.transcriptOnlyCount;\n      const needsAttention = summary.transcriptOnlyCount + summary.failedCount;\n      if (importedCount === 0 && needsAttention === 0) return;\n\n      const conversationLabel = `${importedCount} Codex conversation${importedCount === 1 ? "" : "s"}`;\n      if (needsAttention === 0) {\n        toastManager.add(\n          stackedThreadToast({\n            type: "success",\n            title: `Imported ${conversationLabel}`,\n            description: `Existing Codex history is ready in ${input.projectTitle}.`,\n          }),\n        );\n        return;\n      }\n\n      toastManager.add(\n        stackedThreadToast({\n          type: "warning",\n          title:\n            importedCount > 0\n              ? `Imported ${conversationLabel} with warnings`\n              : "Project added; Codex import incomplete",\n          description: `${needsAttention} conversation${needsAttention === 1 ? "" : "s"} need attention. Use Import conversations to review or retry them.`,\n        }),\n      );\n    },\n    [commitThreadImports, scanThreadImports],\n  );\n\n  const handleAddProjectForEnvironment = useCallback(\n''',
)
replace_once(
    "apps/web/src/components/CommandPalette.tsx",
    '''      const projectId = newProjectId();\n      const targetEnvironmentProviders =\n        environments.find((environment) => environment.environmentId === input.environmentId)\n          ?.serverConfig?.providers ??\n        (input.environmentId === primaryEnvironmentId ? providers : []);\n      const createResult = await createProject({\n''',
    '''      const projectId = newProjectId();\n      const projectTitle = inferProjectTitleFromPath(cwd);\n      const targetEnvironmentProviders =\n        environments.find((environment) => environment.environmentId === input.environmentId)\n          ?.serverConfig?.providers ??\n        (input.environmentId === primaryEnvironmentId ? providers : []);\n      const createResult = await createProject({\n''',
)
replace_once(
    "apps/web/src/components/CommandPalette.tsx",
    '          title: inferProjectTitleFromPath(cwd),\n          workspaceRoot: cwd,\n',
    '          title: projectTitle,\n          workspaceRoot: cwd,\n',
)
replace_once(
    "apps/web/src/components/CommandPalette.tsx",
    '''        return;\n      }\n\n      const navigationResult = await settlePromise(() =>\n        handleNewThread(scopeProjectRef(input.environmentId, projectId)),\n      );\n''',
    '''        return;\n      }\n\n      if (\n        targetEnvironmentProviders.some(\n          (provider) => provider.driver === "codex" && provider.enabled,\n        )\n      ) {\n        void autoImportCodexHistory({\n          environmentId: input.environmentId,\n          projectId,\n          projectTitle,\n        }).catch((error: unknown) => {\n          toastManager.add(\n            stackedThreadToast({\n              type: "warning",\n              title: "Project added; Codex import incomplete",\n              description: errorMessage(error),\n            }),\n          );\n        });\n      }\n\n      const navigationResult = await settlePromise(() =>\n        handleNewThread(scopeProjectRef(input.environmentId, projectId)),\n      );\n''',
)
replace_once(
    "apps/web/src/components/CommandPalette.tsx",
    '''    [\n      handleNewThread,\n      createProject,\n      environments,\n''',
    '''    [\n      handleNewThread,\n      createProject,\n      autoImportCodexHistory,\n      environments,\n''',
)

print("Applied automatic project Codex import patch.")
