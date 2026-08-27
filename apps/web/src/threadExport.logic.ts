import type { OrchestrationMessage, OrchestrationThread } from "@t3tools/contracts";

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

export function formatThreadMarkdown(thread: OrchestrationThread): string {
  const metadata = [
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

  const messages = thread.messages.flatMap((message) => {
    const text = message.text.trim().length > 0 ? message.text : "_(empty message)_";
    return ["", formatMessageHeading(message), "", `${text}${formatAttachments(message)}`];
  });

  return [...metadata, ...messages, ""].join("\n");
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
