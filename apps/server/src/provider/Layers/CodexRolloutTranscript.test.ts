// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe } from "vite-plus/test";

import {
  isUnsupportedCodexTurnHistoryError,
  readCodexRolloutTranscript,
} from "./CodexRolloutTranscript.ts";

const threadId = "01a03631-18a5-7f33-9fee-2e2faec86f92";
const fallbackTimestamp = "2026-08-30T18:00:00.000Z";

function fsEffect<A>(operation: () => Promise<A>): Effect.Effect<A> {
  return Effect.tryPromise(operation).pipe(Effect.orDie);
}

function withTemporaryHome<A, E, R>(
  use: (homePath: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.gen(function* () {
    const root = yield* fsEffect(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-codex-rollout-")),
    );
    return yield* use(NodePath.join(root, ".codex")).pipe(
      Effect.ensuring(
        fsEffect(() => NodeFSP.rm(root, { recursive: true, force: true })).pipe(Effect.orDie),
      ),
    );
  });
}

describe("isUnsupportedCodexTurnHistoryError", () => {
  it("recognizes the Codex legacy list_turns compatibility failure", () => {
    NodeAssert.equal(
      isUnsupportedCodexTurnHistoryError(new Error("list_turns is not supported yet")),
      true,
    );
    NodeAssert.equal(
      isUnsupportedCodexTurnHistoryError({
        detail: "Codex app-server thread read failed: list_turns is not supported yet",
      }),
      true,
    );
  });

  it("does not swallow unrelated app-server failures", () => {
    NodeAssert.equal(isUnsupportedCodexTurnHistoryError(new Error("no rollout found")), false);
    NodeAssert.equal(
      isUnsupportedCodexTurnHistoryError(new Error("thread/items/list is not supported yet")),
      false,
    );
  });
});

describe("readCodexRolloutTranscript", () => {
  it.effect("reconstructs canonical user and assistant messages without event duplicates", () =>
    withTemporaryHome((homePath) =>
      Effect.gen(function* () {
        const archivedPath = NodePath.join(homePath, "archived_sessions");
        yield* fsEffect(() => NodeFSP.mkdir(archivedPath, { recursive: true }));
        const rolloutPath = NodePath.join(
          archivedPath,
          `rollout-2026-08-30T14-04-00-${threadId}.jsonl`,
        );
        const rows = [
          {
            timestamp: "2026-08-30T18:00:01.000Z",
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [
                { type: "input_text", text: "hello from archived history" },
                { type: "input_image", image_url: "file:///ignored.png" },
              ],
            },
          },
          {
            timestamp: "2026-08-30T18:00:01.000Z",
            type: "event_msg",
            payload: { type: "user_message", message: "hello from archived history" },
          },
          {
            timestamp: "2026-08-30T18:00:02.000Z",
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "archived reply" }],
            },
          },
          {
            timestamp: "2026-08-30T18:00:02.000Z",
            type: "event_msg",
            payload: { type: "agent_message", message: "archived reply" },
          },
        ];
        yield* fsEffect(() =>
          NodeFSP.writeFile(
            rolloutPath,
            `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
            "utf8",
          ),
        );

        const result = yield* readCodexRolloutTranscript({
          rolloutPath,
          historyHomePath: homePath,
          externalThreadId: threadId,
          fallbackTimestamp,
          maxMessages: 2_000,
        });

        NodeAssert.deepStrictEqual(result.messages, [
          {
            role: "user",
            text: "hello from archived history",
            createdAt: "2026-08-30T18:00:01.000Z",
          },
          {
            role: "assistant",
            text: "archived reply",
            createdAt: "2026-08-30T18:00:02.000Z",
          },
        ]);
        NodeAssert.deepStrictEqual(result.warnings, [
          "1 non-text user input was omitted from the imported transcript.",
        ]);
      }),
    ),
  );

  it.effect("uses legacy event records only when canonical response messages are absent", () =>
    withTemporaryHome((homePath) =>
      Effect.gen(function* () {
        const sessionsPath = NodePath.join(homePath, "sessions", "2026", "08", "30");
        yield* fsEffect(() => NodeFSP.mkdir(sessionsPath, { recursive: true }));
        const rolloutPath = NodePath.join(
          sessionsPath,
          `rollout-2026-08-30T14-04-00-${threadId}.jsonl`,
        );
        yield* fsEffect(() =>
          NodeFSP.writeFile(
            rolloutPath,
            [
              JSON.stringify({
                timestamp: "2026-08-30T18:00:03.000Z",
                type: "event_msg",
                payload: { type: "user_message", message: "legacy user" },
              }),
              JSON.stringify({
                timestamp: "2026-08-30T18:00:04.000Z",
                type: "event_msg",
                payload: { type: "agent_message", message: "legacy assistant" },
              }),
            ].join("\n"),
            "utf8",
          ),
        );

        const result = yield* readCodexRolloutTranscript({
          rolloutPath,
          historyHomePath: homePath,
          externalThreadId: threadId,
          fallbackTimestamp,
          maxMessages: 2_000,
        });

        NodeAssert.deepStrictEqual(
          result.messages.map(({ role, text }) => ({ role, text })),
          [
            { role: "user", text: "legacy user" },
            { role: "assistant", text: "legacy assistant" },
          ],
        );
        NodeAssert.deepStrictEqual(result.warnings, [
          "The transcript was reconstructed from legacy Codex event records.",
        ]);
      }),
    ),
  );

  it.effect("rejects rollout paths outside the canonical Codex history home", () =>
    withTemporaryHome((homePath) =>
      Effect.gen(function* () {
        const outsidePath = NodePath.join(NodePath.dirname(homePath), `rollout-${threadId}.jsonl`);
        yield* fsEffect(() => NodeFSP.writeFile(outsidePath, "", "utf8"));

        const result = yield* Effect.result(
          readCodexRolloutTranscript({
            rolloutPath: outsidePath,
            historyHomePath: homePath,
            externalThreadId: threadId,
            fallbackTimestamp,
            maxMessages: 2_000,
          }),
        );

        NodeAssert.equal(result._tag, "Failure");
        if (result._tag === "Failure") {
          NodeAssert.match(result.failure.detail, /unexpected history path/u);
        }
      }),
    ),
  );
});
