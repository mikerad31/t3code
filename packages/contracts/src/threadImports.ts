import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ProviderInteractionMode,
  RuntimeMode,
} from "./orchestration.ts";
import {
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  TurnId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ThreadImportCandidateId = TrimmedNonEmptyString.pipe(
  Schema.brand("ThreadImportCandidateId"),
);
export type ThreadImportCandidateId = typeof ThreadImportCandidateId.Type;

export const ThreadImportMessage = Schema.Struct({
  id: MessageId,
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String,
  createdAt: IsoDateTime,
});
export type ThreadImportMessage = typeof ThreadImportMessage.Type;

/** A persisted Codex thread that can be imported into the selected T3 project. */
export const ThreadImportCandidate = Schema.Struct({
  candidateId: ThreadImportCandidateId,
  providerInstanceId: ProviderInstanceId,
  externalThreadId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  preview: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archived: Schema.Boolean,
  canResume: Schema.Boolean,
  alreadyImported: Schema.Boolean,
  warnings: Schema.Array(TrimmedNonEmptyString),
});
export type ThreadImportCandidate = typeof ThreadImportCandidate.Type;

export const ThreadImportScanInput = Schema.Struct({
  projectId: ProjectId,
});
export type ThreadImportScanInput = typeof ThreadImportScanInput.Type;

export const ThreadImportScanResult = Schema.Struct({
  projectId: ProjectId,
  scannedAt: IsoDateTime,
  candidates: Schema.Array(ThreadImportCandidate),
});
export type ThreadImportScanResult = typeof ThreadImportScanResult.Type;

export const ThreadImportCommitInput = Schema.Struct({
  projectId: ProjectId,
  candidateIds: Schema.Array(ThreadImportCandidateId),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
});
export type ThreadImportCommitInput = typeof ThreadImportCommitInput.Type;

export const ThreadImportItemStatus = Schema.Literals([
  "imported",
  "already-imported",
  "transcript-only",
  "skipped",
  "failed",
]);
export type ThreadImportItemStatus = typeof ThreadImportItemStatus.Type;

export const ThreadImportItemResult = Schema.Struct({
  candidateId: ThreadImportCandidateId,
  status: ThreadImportItemStatus,
  threadId: Schema.NullOr(ThreadId),
  importedMessageCount: NonNegativeInt,
  warnings: Schema.Array(TrimmedNonEmptyString),
  error: Schema.optional(TrimmedNonEmptyString),
});
export type ThreadImportItemResult = typeof ThreadImportItemResult.Type;

export const ThreadImportCommitResult = Schema.Struct({
  projectId: ProjectId,
  results: Schema.Array(ThreadImportItemResult),
});
export type ThreadImportCommitResult = typeof ThreadImportCommitResult.Type;

export const ThreadImportErrorCode = Schema.Literals([
  "project-not-found",
  "provider-unavailable",
  "source-unavailable",
  "transcript-unreadable",
  "import-failed",
  "thread-not-found",
  "turn-not-forkable",
  "fork-failed",
]);
export type ThreadImportErrorCode = typeof ThreadImportErrorCode.Type;

export class ThreadImportError extends Schema.TaggedErrorClass<ThreadImportError>()(
  "ThreadImportError",
  {
    code: ThreadImportErrorCode,
    message: TrimmedNonEmptyString,
  },
) {}

/** Branch one completed native Codex turn into a new T3 conversation. */
export const ThreadBranchInput = Schema.Struct({
  threadId: ThreadId,
  /** Native Codex turn id; the fork boundary is inclusive. */
  lastTurnId: TurnId,
});
export type ThreadBranchInput = typeof ThreadBranchInput.Type;

export const ThreadBranchResult = Schema.Struct({
  threadId: ThreadId,
  nativeThreadId: TrimmedNonEmptyString,
  forkedFromId: Schema.NullOr(TrimmedNonEmptyString),
});
export type ThreadBranchResult = typeof ThreadBranchResult.Type;
