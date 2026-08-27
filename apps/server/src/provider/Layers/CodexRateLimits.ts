import * as DateTime from "effect/DateTime";

export interface CodexRateLimitWindowLike {
  readonly usedPercent: number;
  readonly windowDurationMins?: number | null;
  readonly resetsAt?: number | null;
}

export interface CodexRateLimitsLike {
  readonly primary?: CodexRateLimitWindowLike | null;
  readonly secondary?: CodexRateLimitWindowLike | null;
}

export interface CodexRateLimitResetCreditsLike {
  readonly availableCount: number;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatWindowLabel(durationMinutes: number | null | undefined, fallbackIndex: number): string {
  if (durationMinutes === 10_080) return "Weekly";
  if (durationMinutes === 300) return "5h";

  if (durationMinutes !== null && durationMinutes !== undefined && durationMinutes > 0) {
    if (durationMinutes % 1_440 === 0) {
      return `${durationMinutes / 1_440}d`;
    }
    if (durationMinutes % 60 === 0) {
      return `${durationMinutes / 60}h`;
    }
    return `${durationMinutes}m`;
  }

  return `Window ${fallbackIndex}`;
}

function formatResetDistance(resetsAt: number | null | undefined, nowEpochSeconds: number): string | null {
  if (resetsAt === null || resetsAt === undefined || !Number.isFinite(resetsAt)) return null;

  const remainingSeconds = Math.max(0, Math.ceil(resetsAt - nowEpochSeconds));
  if (remainingSeconds === 0) return "now";
  if (remainingSeconds < 60) return "<1m";

  const totalMinutes = Math.ceil(remainingSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

function formatWindow(
  window: CodexRateLimitWindowLike,
  fallbackIndex: number,
  nowEpochSeconds: number,
): string {
  const remainingPercent = 100 - clampPercent(window.usedPercent);
  const label = formatWindowLabel(window.windowDurationMins, fallbackIndex);
  const resetDistance = formatResetDistance(window.resetsAt, nowEpochSeconds);

  return `${label}: ${formatPercent(remainingPercent)}% left${
    resetDistance ? `, resets ${resetDistance === "now" ? "now" : `in ${resetDistance}`}` : ""
  }`;
}

function formatResetCredits(
  resetCredits: CodexRateLimitResetCreditsLike | null | undefined,
): string | null {
  if (!resetCredits || !Number.isFinite(resetCredits.availableCount)) return null;
  const availableCount = Math.max(0, Math.trunc(resetCredits.availableCount));
  return `Banked resets: ${availableCount}`;
}

/**
 * Produce the compact subscription-limit detail rendered under a Codex
 * provider instance. Labels are derived from the server-reported window
 * duration rather than assuming primary/secondary have fixed semantics.
 * The app-server's `availableCount` is authoritative for banked resets.
 */
export function formatCodexRateLimitMessage(
  rateLimits: CodexRateLimitsLike | null | undefined,
  nowEpochSeconds = DateTime.toEpochSeconds(DateTime.nowUnsafe()),
  resetCredits?: CodexRateLimitResetCreditsLike | null,
): string | undefined {
  const windows = [rateLimits?.primary, rateLimits?.secondary].filter(
    (window): window is CodexRateLimitWindowLike => window !== null && window !== undefined,
  );
  const parts = windows.map((window, index) => formatWindow(window, index + 1, nowEpochSeconds));
  const resetCreditsText = formatResetCredits(resetCredits);
  if (resetCreditsText) parts.push(resetCreditsText);
  return parts.length > 0 ? `Limits — ${parts.join(" · ")}` : undefined;
}
