export interface ParsedCodexLimitWindow {
  readonly label: string;
  readonly remainingPercent: number;
  readonly resetText: string | null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Parse the compact Codex provider-status detail emitted by our server-side
 * rate-limit formatter. Keeping the parser isolated means the sidebar UI can
 * be replaced with a structured contract later without touching presentation.
 */
export function parseCodexLimitMessage(
  message: string | null | undefined,
): ReadonlyArray<ParsedCodexLimitWindow> {
  if (!message?.startsWith("Limits — ")) return [];

  const body = message.slice("Limits — ".length);
  const windows: ParsedCodexLimitWindow[] = [];

  for (const segment of body.split(" · ")) {
    const match = segment.match(/^(.+?):\s*(-?\d+(?:\.\d+)?)% left(?:,\s*resets\s+(.+))?$/);
    if (!match) continue;

    const label = match[1]?.trim();
    const remainingPercent = Number(match[2]);
    if (!label || !Number.isFinite(remainingPercent)) continue;

    const resetText = match[3]?.trim();
    windows.push({
      label,
      remainingPercent: clampPercent(remainingPercent),
      resetText: resetText ? resetText : null,
    });
  }

  return windows;
}

/**
 * `availableCount` from Codex is authoritative. The server emits it as a
 * dedicated status segment so this feature can remain additive to the quota-v1
 * wire shape while the destructive consume operation uses its own typed RPC.
 */
export function parseCodexBankedResetCount(message: string | null | undefined): number | null {
  if (!message?.startsWith("Limits — ")) return null;
  for (const segment of message.slice("Limits — ".length).split(" · ")) {
    const match = segment.match(/^Banked resets:\s*(\d+)$/);
    if (!match) continue;
    const value = Number(match[1]);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  return null;
}
