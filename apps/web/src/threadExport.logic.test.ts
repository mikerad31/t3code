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
} as unknown as OrchestrationThread;

describe("thread export formatting", () => {
  it("formats a readable Markdown transcript with metadata and attachments", () => {
    const markdown = formatThreadMarkdown(thread);
    expect(markdown).toContain("# Quota dashboard: polish / test");
    expect(markdown).toContain("### User — 2026-08-27T01:00:00.000Z");
    expect(markdown).toContain("Build the quota popup.");
    expect(markdown).toContain("### Assistant — 2026-08-27T01:01:00.000Z");
    expect(markdown).toContain("- quota.png");
  });

  it("exports versioned JSON without losing the native thread shape", () => {
    expect(buildThreadExportDocument(thread)).toEqual({ schemaVersion: 1, thread });
    expect(JSON.parse(formatThreadJson(thread))).toEqual({ schemaVersion: 1, thread });
  });

  it("builds filesystem-friendly deterministic names", () => {
    expect(threadExportBaseName(thread)).toBe("quota-dashboard-polish-test-thread-1");
  });
});
