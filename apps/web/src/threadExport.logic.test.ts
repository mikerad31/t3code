import type { OrchestrationThread } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadExportDocument,
  formatThreadJson,
  formatThreadMarkdown,
  threadExportBaseName,
} from "./threadExport.logic";

const thread = {
  id: "thread-12345678",
  projectId: "project-1",
  title: "Quota dashboard: polish / test",
  branch: "feat/quota",
  worktreePath: "F:/Development/t3code-quota",
  createdAt: "2026-08-27T01:00:00.000Z",
  updatedAt: "2026-08-27T02:00:00.000Z",
  messages: [
    {
      id: "message-user",
      role: "user",
      text: "Build the quota popup.",
      turnId: "turn-1",
      streaming: false,
      createdAt: "2026-08-27T01:00:00.000Z",
      updatedAt: "2026-08-27T01:00:00.000Z",
    },
    {
      id: "message-assistant",
      role: "assistant",
      text: "Implemented it.",
      attachments: [{ id: "attachment-1", name: "quota.png", mimeType: "image/png" }],
      turnId: "turn-1",
      streaming: false,
      createdAt: "2026-08-27T01:01:00.000Z",
      updatedAt: "2026-08-27T01:01:00.000Z",
    },
  ],
  activities: [
    {
      id: "event-1",
      tone: "tool",
      kind: "mcp.tool.completed",
      summary: "Read repository context",
      payload: { tool: "repowise", result: "context loaded" },
      turnId: "turn-1",
      sequence: 42,
      createdAt: "2026-08-27T01:00:30.000Z",
    },
  ],
  proposedPlans: [
    {
      id: "plan-1",
      turnId: "turn-1",
      planMarkdown: "1. Inspect\n2. Implement",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: "2026-08-27T01:00:20.000Z",
      updatedAt: "2026-08-27T01:00:20.000Z",
    },
  ],
  checkpoints: [
    {
      turnId: "turn-1",
      checkpointTurnCount: 1,
      checkpointRef: "checkpoint-1",
      status: "ready",
      files: [{ path: "src/quota.ts", kind: "modified", additions: 12, deletions: 2 }],
      assistantMessageId: "message-assistant",
      completedAt: "2026-08-27T01:01:05.000Z",
    },
  ],
  session: {
    threadId: "thread-12345678",
    status: "ready",
    providerName: "codex",
    providerInstanceId: "codex-a1",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: "2026-08-27T01:01:05.000Z",
  },
} as unknown as OrchestrationThread;

describe("thread export formatting", () => {
  it("formats a readable Markdown transcript with persisted inspection data", () => {
    const markdown = formatThreadMarkdown(thread);
    expect(markdown).toContain("# Quota dashboard: polish / test");
    expect(markdown).toContain("### User — 2026-08-27T01:00:00.000Z");
    expect(markdown).toContain("Build the quota popup.");
    expect(markdown).toContain("### Assistant — 2026-08-27T01:01:00.000Z");
    expect(markdown).toContain("- quota.png");
    expect(markdown).toContain("## Activity log");
    expect(markdown).toContain("mcp.tool.completed");
    expect(markdown).toContain('"tool": "repowise"');
    expect(markdown).toContain("## Proposed plans");
    expect(markdown).toContain("1. Inspect");
    expect(markdown).toContain("## Checkpoints");
    expect(markdown).toContain("`src/quota.ts` (modified, +12 / -2)");
    expect(markdown).toContain("## Session");
    expect(markdown).toContain("- Provider instance: codex-a1");
  });

  it("exports versioned JSON without losing the native thread shape", () => {
    expect(buildThreadExportDocument(thread)).toEqual({ schemaVersion: 1, thread });
    expect(JSON.parse(formatThreadJson(thread))).toEqual({ schemaVersion: 1, thread });
  });

  it("builds filesystem-friendly deterministic names", () => {
    expect(threadExportBaseName(thread)).toBe("quota-dashboard-polish-test-thread-1");
  });
});