import { assert, it } from "@effect/vitest";

import { formatCodexRateLimitMessage } from "./CodexRateLimits.ts";

const NOW = 2_000_000_000;

it("formats five-hour and weekly windows from their reported durations", () => {
  assert.strictEqual(
    formatCodexRateLimitMessage(
      {
        primary: {
          usedPercent: 27,
          windowDurationMins: 300,
          resetsAt: NOW + 2 * 60 * 60 + 14 * 60,
        },
        secondary: {
          usedPercent: 39,
          windowDurationMins: 10_080,
          resetsAt: NOW + 4 * 24 * 60 * 60 + 8 * 60 * 60,
        },
      },
      NOW,
    ),
    "Limits — 5h: 73% left, resets in 2h 14m · Weekly: 61% left, resets in 4d 8h",
  );
});

it("derives labels from duration even when the windows are reversed", () => {
  assert.strictEqual(
    formatCodexRateLimitMessage(
      {
        primary: { usedPercent: 10, windowDurationMins: 10_080 },
        secondary: { usedPercent: 20, windowDurationMins: 300 },
      },
      NOW,
    ),
    "Limits — Weekly: 90% left · 5h: 80% left",
  );
});

it("uses generic duration labels and a neutral fallback when duration is unavailable", () => {
  assert.strictEqual(
    formatCodexRateLimitMessage(
      {
        primary: { usedPercent: 12.5, windowDurationMins: 120 },
        secondary: { usedPercent: 50 },
      },
      NOW,
    ),
    "Limits — 2h: 87.5% left · Window 2: 50% left",
  );
});

it("clamps malformed usage percentages and handles an elapsed reset", () => {
  assert.strictEqual(
    formatCodexRateLimitMessage(
      {
        primary: { usedPercent: 140, windowDurationMins: 300, resetsAt: NOW - 1 },
        secondary: { usedPercent: -20, windowDurationMins: 10_080 },
      },
      NOW,
    ),
    "Limits — 5h: 0% left, resets now · Weekly: 100% left",
  );
});

it("returns undefined when no rate-limit windows are available", () => {
  assert.strictEqual(formatCodexRateLimitMessage(null, NOW), undefined);
  assert.strictEqual(formatCodexRateLimitMessage({}, NOW), undefined);
});
