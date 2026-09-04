import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type { TurnId } from "@t3tools/contracts";

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

export interface ProviderThreadImportNativeThread {
  readonly threadId: string;
  readonly turns: ReadonlyArray<{
    readonly id: TurnId;
    readonly items: ReadonlyArray<unknown>;
  }>;
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
  /**
   * Read native turns without recovering or opening a T3 provider session.
   * This is intentionally separate from `read`: transcript imports may use a
   * rollout fallback, while branch boundaries require exact native turn IDs.
   */
  readonly readNativeThread?: (input: {
    readonly projectRoot: string;
    readonly externalThreadId: string;
  }) => Effect.Effect<ProviderThreadImportNativeThread, ProviderThreadImportError>;
}
