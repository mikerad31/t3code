import { describe, expect, it } from "vite-plus/test";

import {
  parseCodexBankedResetCount,
  parseCodexLimitMessage,
} from "./SidebarCodexLimitsPopover.logic.ts";

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

describe("parseCodexBankedResetCount", () => {
  it("parses positive and zero banked reset counts", () => {
    expect(
      parseCodexBankedResetCount("Limits — 5h: 99% left · Weekly: 51% left · Banked resets: 2"),
    ).toBe(2);
    expect(parseCodexBankedResetCount("Limits — Banked resets: 0")).toBe(0);
  });

  it("returns null when a count is missing, malformed, or outside the safe integer range", () => {
    expect(parseCodexBankedResetCount(undefined)).toBeNull();
    expect(parseCodexBankedResetCount("Codex is not authenticated.")).toBeNull();
    expect(parseCodexBankedResetCount("Limits — Banked resets: -1")).toBeNull();
    expect(parseCodexBankedResetCount("Limits — Banked resets: nope")).toBeNull();
    expect(parseCodexBankedResetCount("Limits — Banked resets: 999999999999999999999")).toBeNull();
  });
});
