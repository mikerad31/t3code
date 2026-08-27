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
 * Keep the default Codex instance visually consistent with explicitly named
 * sibling accounts. A custom display name always wins; only the generic
 * built-in "Codex" label is normalized to A1 when multiple accounts exist.
 */
export function resolveCodexAccountLabel(input: {
  readonly displayName: string | null | undefined;
  readonly ordinal: number;
  readonly accountCount: number;
}): string {
  const configured = input.displayName?.trim();
  if (configured && (configured !== "Codex" || input.accountCount <= 1)) {
    return configured;
  }
  return input.accountCount > 1 ? `A${input.ordinal + 1}` : configured || "Codex";
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
