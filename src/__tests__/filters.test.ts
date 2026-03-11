import { describe, it, expect } from "vitest";
import { isoWeekToDateRange } from "../aggregator/filters.js";

describe("isoWeekToDateRange", () => {
  it("returns Monday-Sunday for a known week", () => {
    // 2026-W10: Monday = 2026-03-02, Sunday = 2026-03-08
    const range = isoWeekToDateRange("2026-W10");
    expect(range.since).toBe("2026-03-02");
    expect(range.until).toBe("2026-03-08");
  });

  it("handles week 1 correctly", () => {
    // 2026-W01: Monday = 2025-12-29, Sunday = 2026-01-04
    const range = isoWeekToDateRange("2026-W01");
    expect(range.since).toBe("2025-12-29");
    expect(range.until).toBe("2026-01-04");
  });

  it("handles the last week of a year", () => {
    // 2025-W52: Monday = 2025-12-22, Sunday = 2025-12-28
    const range = isoWeekToDateRange("2025-W52");
    expect(range.since).toBe("2025-12-22");
    expect(range.until).toBe("2025-12-28");
  });

  it("throws on invalid format", () => {
    expect(() => isoWeekToDateRange("2026-10")).toThrow("Invalid ISO week format");
  });
});
