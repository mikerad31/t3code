from pathlib import Path


def replace_once(path_str: str, old: str, new: str, label: str) -> None:
    path = Path(path_str)
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/web/src/components/ThreadImportDialog.tsx",
    """    setResultsById(new Map());
    setCommitError(null);""",
    """    setCommitError(null);""",
    "preserve import result statuses across automatic rescans",
)

replace_once(
    "apps/server/src/threadImport/ThreadImportService.ts",
    """      const importedIds = yield* existingThreadIds();
      const scanned: ScannedCandidate[] = [];
      for (const instance of instances) {""",
    """      const importedIds = yield* existingThreadIds();
      const scanned: ScannedCandidate[] = [];
      let successfulScans = 0;
      let lastScanFailure: { readonly detail: string } | undefined;
      for (const instance of instances) {""",
    "track provider scan outcomes",
)

replace_once(
    "apps/server/src/threadImport/ThreadImportService.ts",
    """        if (Result.isFailure(result)) continue;

        for (const source of result.success) {""",
    """        if (Result.isFailure(result)) {
          lastScanFailure = result.failure;
          continue;
        }
        successfulScans += 1;

        for (const source of result.success) {""",
    "record provider scan failures",
)

replace_once(
    "apps/server/src/threadImport/ThreadImportService.ts",
    """      return scanned.toSorted(
        (left, right) =>
          Date.parse(right.candidate.updatedAt) - Date.parse(left.candidate.updatedAt),
      );""",
    """      if (successfulScans === 0 && lastScanFailure !== undefined) {
        return yield* Effect.fail(error("source-unavailable", lastScanFailure.detail));
      }
      return scanned.toSorted(
        (left, right) =>
          Date.parse(right.candidate.updatedAt) - Date.parse(left.candidate.updatedAt),
      );""",
    "surface total Codex source scan failure",
)
