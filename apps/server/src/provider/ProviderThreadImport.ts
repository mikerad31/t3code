import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export interface ProviderThreadImportCandidate {
  readonly externalThreadId: string;
  readonly title: string;
  readonly preview: string | null;
  readonly sourceCwd: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archived: boolean;
  readonly warnings: ReadonlyArray<string>;
}

export interface ProviderThreadImportMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly createdAt: string;
}

export interface ProviderThreadImportTranscript {
  readonly externalThreadId: string;
  readonly title: string;
  readonly preview: string | null;
  readonly sourceCwd: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archived: boolean;
  readonly messages: ReadonlyArray<ProviderThreadImportMessage>;
  readonly resumeCursor: unknown | null;
  readonly warnings: ReadonlyArray<string>;
}

export class ProviderThreadImportError extends Data.TaggedError("ProviderThreadImportError")<{
  readonly operation: "scan" | "read";
  readonly detail: string;
  readonly cause?: unknown;
}> {}

/**
 * Optional per-provider-instance capability for discovering persisted native
 * conversations and materializing a readable transcript. Implementations own
 * all provider-specific storage/protocol semantics; the orchestration import
 * service only deals with this normalized shape.
 */
export interface ProviderThreadImportShape {
  readonly scan: (input: {
    readonly projectRoot: string;
  }) => Effect.Effect<ReadonlyArray<ProviderThreadImportCandidate>, ProviderThreadImportError>;
  readonly read: (input: {
    readonly projectRoot: string;
    readonly externalThreadId: string;
    readonly archived: boolean;
  }) => Effect.Effect<ProviderThreadImportTranscript, ProviderThreadImportError>;
}
