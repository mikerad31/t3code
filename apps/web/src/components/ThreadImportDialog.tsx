import type {
  EnvironmentId,
  ProjectId,
  ThreadImportCandidate,
  ThreadImportItemResult,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AlertTriangleIcon, ArchiveIcon, CheckCircle2Icon, RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { serverEnvironment } from "../state/server";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

export interface ThreadImportTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly environmentLabel: string;
}

interface ThreadImportDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projectTitle: string;
  readonly targets: ReadonlyArray<ThreadImportTarget>;
}

function formatCandidateDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusLabel(result: ThreadImportItemResult): string {
  switch (result.status) {
    case "imported":
      return `Imported ${result.importedMessageCount} message${result.importedMessageCount === 1 ? "" : "s"}`;
    case "already-imported":
      return "Already imported";
    case "transcript-only":
      return `Imported ${result.importedMessageCount} message${result.importedMessageCount === 1 ? "" : "s"}; resume unavailable`;
    case "failed":
      return result.error ?? "Import failed";
  }
}

function ThreadImportTargetPanel(props: {
  readonly target: ThreadImportTarget;
  readonly showEnvironmentLabel: boolean;
}) {
  const { target, showEnvironmentLabel } = props;
  const scan = useEnvironmentQuery(
    serverEnvironment.threadImportScan({
      environmentId: target.environmentId,
      input: { projectId: target.projectId },
    }),
  );
  const commitImports = useAtomCommand(serverEnvironment.threadImportCommit, {
    reportFailure: false,
  });
  const candidates = scan.data?.candidates ?? [];
  const candidateKey = candidates
    .map((candidate) => `${candidate.candidateId}:${candidate.alreadyImported ? "1" : "0"}`)
    .join("\0");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [resultsById, setResultsById] = useState<ReadonlyMap<string, ThreadImportItemResult>>(
    new Map(),
  );
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);

  useEffect(() => {
    setSelectedIds(
      new Set(
        candidates
          .filter((candidate) => !candidate.alreadyImported)
          .map((candidate) => String(candidate.candidateId)),
      ),
    );
    setResultsById(new Map());
    setCommitError(null);
  }, [candidateKey]);

  const selectableCandidates = useMemo(
    () => candidates.filter((candidate) => !candidate.alreadyImported),
    [candidates],
  );
  const selectedCount = selectedIds.size;
  const allSelectableSelected =
    selectableCandidates.length > 0 && selectedCount === selectableCandidates.length;

  const toggleCandidate = (candidate: ThreadImportCandidate) => {
    if (candidate.alreadyImported) return;
    const key = String(candidate.candidateId);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(
      allSelectableSelected
        ? new Set()
        : new Set(selectableCandidates.map((candidate) => String(candidate.candidateId))),
    );
  };

  const importSelected = async () => {
    if (selectedCount === 0 || isCommitting) return;
    setCommitError(null);
    setIsCommitting(true);
    try {
      const candidateIds = candidates
        .filter((candidate) => selectedIds.has(String(candidate.candidateId)))
        .map((candidate) => candidate.candidateId);
      const result = await commitImports({
        environmentId: target.environmentId,
        input: {
          projectId: target.projectId,
          candidateIds,
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setCommitError(error instanceof Error ? error.message : "Conversation import failed.");
        }
        return;
      }
      setResultsById(new Map(result.value.results.map((item) => [String(item.candidateId), item])));
      setSelectedIds(new Set());
      scan.refresh();
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-col gap-3">
      {showEnvironmentLabel ? (
        <div className="flex items-center justify-between gap-3">
          <h3 className="truncate text-sm font-medium">{target.environmentLabel}</h3>
          <span className="shrink-0 text-xs text-muted-foreground">
            {candidates.length} found
          </span>
        </div>
      ) : null}

      {scan.isPending && scan.data === null ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
          <RefreshCwIcon className="size-4 animate-spin" />
          Scanning Codex history…
        </div>
      ) : scan.error !== null ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Couldn’t scan Codex conversations</p>
              <p className="mt-1 break-words text-xs text-destructive/80">{scan.error}</p>
            </div>
          </div>
          <Button className="mt-3" size="sm" variant="outline" onClick={scan.refresh}>
            Retry
          </Button>
        </div>
      ) : candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No Codex conversations were found for this project.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={allSelectableSelected}
                onChange={toggleAll}
                disabled={selectableCandidates.length === 0 || isCommitting}
              />
              Select all new conversations
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={scan.refresh}
              disabled={scan.isPending || isCommitting}
            >
              <RefreshCwIcon className={scan.isPending ? "animate-spin" : undefined} />
              Rescan
            </Button>
          </div>

          <div className="flex max-h-[min(52vh,32rem)] flex-col gap-2 overflow-y-auto pe-1">
            {candidates.map((candidate) => {
              const key = String(candidate.candidateId);
              const result = resultsById.get(key);
              const checked = selectedIds.has(key);
              return (
                <label
                  key={key}
                  className={`flex gap-3 rounded-lg border p-3 ${
                    candidate.alreadyImported
                      ? "cursor-default bg-muted/35 opacity-75"
                      : "cursor-pointer hover:bg-muted/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 rounded border-input"
                    checked={checked}
                    onChange={() => toggleCandidate(candidate)}
                    disabled={candidate.alreadyImported || isCommitting}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{candidate.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Updated {formatCandidateDate(candidate.updatedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        {candidate.archived ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                            <ArchiveIcon className="size-3" />
                            Archived
                          </span>
                        ) : null}
                        <span className="rounded-full bg-muted px-2 py-0.5">
                          {candidate.canResume ? "Resumable" : "Transcript"}
                        </span>
                      </div>
                    </div>
                    {candidate.preview ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {candidate.preview}
                      </p>
                    ) : null}
                    {candidate.warnings.length > 0 ? (
                      <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                        <span>{candidate.warnings.join(" · ")}</span>
                      </div>
                    ) : null}
                    {candidate.alreadyImported ? (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2Icon className="size-3.5" />
                        Already imported into T3
                      </div>
                    ) : null}
                    {result ? (
                      <div
                        className={`mt-2 text-xs ${
                          result.status === "failed"
                            ? "text-destructive"
                            : result.status === "transcript-only"
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        {statusLabel(result)}
                        {result.warnings.length > 0 ? ` · ${result.warnings.join(" · ")}` : ""}
                      </div>
                    ) : null}
                  </div>
                </label>
              );
            })}
          </div>

          {commitError ? <p className="text-xs text-destructive">{commitError}</p> : null}

          <div className="flex items-center justify-end">
            <Button onClick={() => void importSelected()} disabled={selectedCount === 0 || isCommitting}>
              {isCommitting
                ? "Importing…"
                : `Import ${selectedCount} conversation${selectedCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function ThreadImportDialog(props: ThreadImportDialogProps) {
  const { open, onOpenChange, projectTitle, targets } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="w-[min(44rem,calc(100vw-2rem))] max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import conversations</DialogTitle>
          <DialogDescription>
            Bring persisted Codex conversations into {projectTitle}. New conversations are selected by
            default; imported conversations stay disabled so repeated scans are safe.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-5">
          {targets.length > 0 ? (
            targets.map((target) => (
              <ThreadImportTargetPanel
                key={`${target.environmentId}:${target.projectId}`}
                target={target}
                showEnvironmentLabel={targets.length > 1}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              This project does not have an importable environment target.
            </div>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
