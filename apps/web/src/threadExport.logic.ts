import type {
  OrchestrationMessage,
  OrchestrationThread,
  OrchestrationThreadActivity,
} from "@t3tools/contracts";

export interface ThreadExportDocument {
  readonly schemaVersion: 1;
  readonly thread: OrchestrationThread;
}

function formatMessageHeading(message: OrchestrationMessage): string {
  const role =
    message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System";
  return `### ${role} — ${message.createdAt}`;
}

function formatAttachments(message: OrchestrationMessage): string {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return "";
  return `\n\nAttachments:\n${attachments.map((attachment) => `- ${attachment.name}`).join("\n")}`;
}

function formatActivity(activity: OrchestrationThreadActivity): string[] {
  const payload = JSON.stringify(activity.payload, null, 2) ?? String(activity.payload);
  return [
    "",
    `### ${activity.kind} — ${activity.createdAt}`,
    "",
    `- Tone: ${activity.tone}`,
    activity.turnId ? `- Turn: \`${activity.turnId}\`` : null,
    activity.sequence === undefined ? null : `- Sequence: ${activity.sequence}`,
    "",
    activity.summary,
    "",
    "````json",
    payload,
    "````",
  ].filter((line): line is string => line !== null);
}

export function formatThreadMarkdown(thread: OrchestrationThread): string {
  const lines: string[] = [
    `# ${thread.title}`,
    "",
    `- Thread ID: \`${thread.id}\``,
    `- Project ID: \`${thread.projectId}\``,
    `- Created: ${thread.createdAt}`,
    `- Updated: ${thread.updatedAt}`,
    thread.branch ? `- Branch: \`${thread.branch}\`` : null,
    thread.worktreePath ? `- Worktree: \`${thread.worktreePath}\`` : null,
    "",
    "## Conversation",
  ].filter((line): line is string => line !== null);

  for (const message of thread.messages) {
    const text = message.text.trim().length > 0 ? message.text : "_(empty message)_";
    lines.push("", formatMessageHeading(message), "", `${text}${formatAttachments(message)}`);
  }

  if (thread.activities.length > 0) {
    lines.push("", "## Activity log");
    for (const activity of thread.activities) lines.push(...formatActivity(activity));
  }

  if (thread.proposedPlans.length > 0) {
    lines.push("", "## Proposed plans");
    for (const plan of thread.proposedPlans) {
      lines.push(
        "",
        `### Plan — ${plan.createdAt}`,
        "",
        plan.turnId ? `- Turn: \`${plan.turnId}\`` : "- Turn: none",
        plan.implementedAt ? `- Implemented: ${plan.implementedAt}` : "- Implemented: no",
        plan.implementationThreadId
          ? `- Implementation thread: \`${plan.implementationThreadId}\``
          : "- Implementation thread: none",
        "",
        plan.planMarkdown,
      );
    }
  }

  if (thread.checkpoints.length > 0) {
    lines.push("", "## Checkpoints");
    for (const checkpoint of thread.checkpoints) {
      lines.push(
        "",
        `### Turn ${checkpoint.turnId} — ${checkpoint.completedAt}`,
        "",
        `- Status: ${checkpoint.status}`,
        `- Checkpoint ref: \`${checkpoint.checkpointRef}\``,
        `- Checkpoint turn count: ${checkpoint.checkpointTurnCount}`,
        checkpoint.assistantMessageId
          ? `- Assistant message: \`${checkpoint.assistantMessageId}\``
          : "- Assistant message: none",
      );
      if (checkpoint.files.length > 0) {
        lines.push(
          "",
          "Files:",
          ...checkpoint.files.map(
            (file) => `- \`${file.path}\` (${file.kind}, +${file.additions} / -${file.deletions})`,
          ),
        );
      }
    }
  }

  if (thread.session !== null) {
    lines.push(
      "",
      "## Session",
      "",
      `- Status: ${thread.session.status}`,
      `- Provider: ${thread.session.providerName ?? "none"}`,
      `- Provider instance: ${thread.session.providerInstanceId ?? "none"}`,
      `- Runtime mode: ${thread.session.runtimeMode}`,
      `- Active turn: ${thread.session.activeTurnId ?? "none"}`,
      `- Updated: ${thread.session.updatedAt}`,
      thread.session.lastError ? `- Last error: ${thread.session.lastError}` : null,
    );
  }

  lines.push("");
  return lines.filter((line): line is string => line !== null).join("\n");
}

export function buildThreadExportDocument(thread: OrchestrationThread): ThreadExportDocument {
  return { schemaVersion: 1, thread };
}

export function formatThreadJson(thread: OrchestrationThread): string {
  return `${JSON.stringify(buildThreadExportDocument(thread), null, 2)}\n`;
}

export function threadExportBaseName(thread: Pick<OrchestrationThread, "id" | "title">): string {
  const slug = thread.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return `${slug || "thread"}-${thread.id.slice(0, 8)}`;
}