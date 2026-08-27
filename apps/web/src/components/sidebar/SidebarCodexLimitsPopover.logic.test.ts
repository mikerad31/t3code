import { describe, expect, it } from "vitest";

import { parseCodexLimitMessage } from "./SidebarCodexLimitsPopover.logic.ts";

describe("parseCodexLimitMessage", () => {
  it("parses five-hour and weekly limits", () => {
    expect(
      parseCodexLimitMessage(
        "Limits — 5h: 99% left, resets in 4h 4m · Weekly: 51% left, resets in 5d 6h",
      ),
    ).toEqual([
      { label: "5h", remainingPercent: 99, resetText: "in 4h 4m" },
      { label: "Weekly", remainingPercent: 51, resetText: "in 5d 6h" },
    ]);
  });

  it("keeps decimal percentages and missing reset text", () => {
    expect(parseCodexLimitMessage("Limits — 2h: 87.5% left · Window 2: 50% left")).toEqual([
      { label: "2h", remainingPercent: 87.5, resetText: null },
      { label: "Window 2", remainingPercent: 50, resetText: null },
    ]);
  });

  it("clamps malformed percentages", () => {
    expect(parseCodexLimitMessage("Limits — 5h: 140% left · Weekly: -20% left")).toEqual([
      { label: "5h", remainingPercent: 100, resetText: null },
      { label: "Weekly", remainingPercent: 0, resetText: null },
    ]);
  });

  it("ignores non-limit provider messages", () => {
    expect(parseCodexLimitMessage(undefined)).toEqual([]);
    expect(parseCodexLimitMessage("Codex is not authenticated.")).toEqual([]);
  });
});
