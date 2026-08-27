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
    const match = segment.match(
      /^(.+?):\s*(-?\d+(?:\.\d+)?)% left(?:,\s*resets\s+(.+))?$/,
    );
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
