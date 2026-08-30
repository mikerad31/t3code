// @effect-diagnostics globalDate:off
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

import {
  type ProviderThreadImportMessage,
  ProviderThreadImportError,
} from "../ProviderThreadImport.ts";

interface RolloutReadResult {
  readonly messages: ReadonlyArray<ProviderThreadImportMessage>;
  readonly warnings: ReadonlyArray<string>;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function diagnosticText(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) {
    return `${value.message} ${diagnosticText(value.cause, depth + 1)}`.trim();
  }
  const object = asObject(value);
  if (!object) return "";
  return ["message", "detail", "cause", "error"]
    .map((key) => diagnosticText(object[key], depth + 1))
    .filter((entry) => entry.length > 0)
    .join(" ");
}

export function isUnsupportedCodexTurnHistoryError(cause: unknown): boolean {
  const detail = diagnosticText(cause).toLowerCase();
  return detail.includes("list_turns") && detail.includes("not supported");
}

function timestampOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return Number.isFinite(Date.parse(value)) ? value : fallback;
}

function messageFromResponseItem(
  row: JsonObject,
  fallbackTimestamp: string,
): { readonly message: ProviderThreadImportMessage; readonly skippedRichInputs: number } | undefined {
  if (row.type !== "response_item") return undefined;
  const payload = asObject(row.payload);
  if (!payload || payload.type !== "message") return undefined;
  const role = payload.role;
  if (role !== "user" && role !== "assistant") return undefined;
  const content = Array.isArray(payload.content) ? payload.content : [];
  const acceptedType = role === "user" ? "input_text" : "output_text";
  const textParts: string[] = [];
  let skippedRichInputs = 0;
  for (const rawPart of content) {
    const part = asObject(rawPart);
    if (!part) continue;
    if (part.type === acceptedType && typeof part.text === "string") {
      const text = part.text.trim();
      if (text.length > 0) textParts.push(text);
    } else if (role === "user") {
      skippedRichInputs += 1;
    }
  }
  const text = textParts.join("\n\n").trim();
  if (text.length === 0) return undefined;
  return {
    message: {
      role,
      text,
      createdAt: timestampOrFallback(row.timestamp, fallbackTimestamp),
    },
    skippedRichInputs,
  };
}

function messageFromLegacyEvent(
  row: JsonObject,
  fallbackTimestamp: string,
): ProviderThreadImportMessage | undefined {
  if (row.type !== "event_msg") return undefined;
  const payload = asObject(row.payload);
  if (!payload || typeof payload.message !== "string") return undefined;
  const role =
    payload.type === "user_message"
      ? "user"
      : payload.type === "agent_message"
        ? "assistant"
        : undefined;
  if (!role) return undefined;
  const text = payload.message.trim();
  if (text.length === 0) return undefined;
  return {
    role,
    text,
    createdAt: timestampOrFallback(row.timestamp, fallbackTimestamp),
  };
}

function pathIsInside(rootPath: string, candidatePath: string): boolean {
  const relative = NodePath.relative(NodePath.resolve(rootPath), NodePath.resolve(candidatePath));
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${NodePath.sep}`) &&
    !NodePath.isAbsolute(relative)
  );
}

function causeMessage(cause: unknown): string {
  const detail = diagnosticText(cause).trim();
  return detail.length > 0 ? detail : String(cause);
}

export function readCodexRolloutTranscript(input: {
  readonly rolloutPath: string;
  readonly historyHomePath: string;
  readonly externalThreadId: string;
  readonly fallbackTimestamp: string;
  readonly maxMessages: number;
}): Effect.Effect<RolloutReadResult, ProviderThreadImportError> {
  return Effect.gen(function* () {
    const rolloutPath = NodePath.resolve(input.rolloutPath);
    if (
      !pathIsInside(input.historyHomePath, rolloutPath) ||
      NodePath.extname(rolloutPath).toLowerCase() !== ".jsonl" ||
      !NodePath.basename(rolloutPath).includes(input.externalThreadId)
    ) {
      return yield* Effect.fail(
        new ProviderThreadImportError({
          operation: "read",
          detail: `Codex rollout fallback rejected an unexpected history path for thread '${input.externalThreadId}'.`,
        }),
      );
    }

    const contents = yield* Effect.tryPromise({
      try: () => NodeFSP.readFile(rolloutPath, "utf8"),
      catch: (cause) =>
        new ProviderThreadImportError({
          operation: "read",
          detail: `Codex rollout fallback could not read '${rolloutPath}': ${causeMessage(cause)}`,
          cause,
        }),
    });

    const responseMessages: ProviderThreadImportMessage[] = [];
    const legacyEventMessages: ProviderThreadImportMessage[] = [];
    let malformedLines = 0;
    let skippedRichInputs = 0;

    for (const rawLine of contents.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (line.length === 0) continue;
      let row: JsonObject | undefined;
      try {
        row = asObject(JSON.parse(line));
      } catch {
        malformedLines += 1;
        continue;
      }
      if (!row) continue;
      const responseMessage = messageFromResponseItem(row, input.fallbackTimestamp);
      if (responseMessage) {
        responseMessages.push(responseMessage.message);
        skippedRichInputs += responseMessage.skippedRichInputs;
        continue;
      }
      const legacyMessage = messageFromLegacyEvent(row, input.fallbackTimestamp);
      if (legacyMessage) legacyEventMessages.push(legacyMessage);
    }

    const warnings: string[] = [];
    if (skippedRichInputs > 0) {
      warnings.push(
        `${skippedRichInputs} non-text user input${skippedRichInputs === 1 ? " was" : "s were"} omitted from the imported transcript.`,
      );
    }
    if (malformedLines > 0) {
      warnings.push(
        `${malformedLines} malformed persisted Codex record${malformedLines === 1 ? " was" : "s were"} ignored while importing the transcript.`,
      );
    }

    const selected = responseMessages.length > 0 ? responseMessages : legacyEventMessages;
    if (responseMessages.length === 0 && legacyEventMessages.length > 0) {
      warnings.push("The transcript was reconstructed from legacy Codex event records.");
    }
    const truncated = selected.length > input.maxMessages;
    const messages = truncated ? selected.slice(-input.maxMessages) : selected;
    if (truncated) {
      warnings.push(`Older messages were omitted after the ${input.maxMessages}-message limit.`);
    }

    return { messages, warnings };
  });
}
