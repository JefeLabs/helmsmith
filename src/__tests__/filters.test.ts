import { describe, it, expect } from "vitest";
import {
  isoWeekToDateRange,
  getLastNMonths,
  getLastNQuarters,
  getLastNYears,
  weekToMonth,
  weekToQuarter,
  weekToYear,
} from "../aggregator/filters.js";

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

// ── UTC-consistent month/quarter/year aggregation ──────────────────────────

describe("getLastNMonths", () => {
  it("returns correct months for a mid-year week", () => {
    const months = getLastNMonths(3, "2026-W10"); // W10 2026 Monday = 2026-03-02
    expect(months).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("handles year boundary — W01 of 2026 falls in December 2025", () => {
    // 2026-W01 Monday = 2025-12-29 (UTC)
    const months = getLastNMonths(2, "2026-W01");
    expect(months).toEqual(["2025-11", "2025-12"]);
  });

  it("returns single month", () => {
    const months = getLastNMonths(1, "2026-W20");
    expect(months).toHaveLength(1);
  });
});

describe("getLastNQuarters", () => {
  it("returns correct quarters for a Q1 week", () => {
    const quarters = getLastNQuarters(2, "2026-W10"); // March 2026 → Q1
    expect(quarters).toEqual(["2025-Q4", "2026-Q1"]);
  });

  it("handles year boundary correctly", () => {
    // 2026-W01 Monday = 2025-12-29 → Q4 of 2025
    const quarters = getLastNQuarters(3, "2026-W01");
    expect(quarters).toEqual(["2025-Q2", "2025-Q3", "2025-Q4"]);
  });

  it("returns single quarter", () => {
    const quarters = getLastNQuarters(1, "2026-W30");
    expect(quarters).toHaveLength(1);
    expect(quarters[0]).toMatch(/^\d{4}-Q[1-4]$/);
  });
});

describe("getLastNYears", () => {
  it("returns correct years", () => {
    const years = getLastNYears(3, "2026-W10");
    expect(years).toEqual(["2024", "2025", "2026"]);
  });

  it("handles year boundary — W01 maps to previous year", () => {
    // 2026-W01 Monday = 2025-12-29 → year 2025
    const years = getLastNYears(2, "2026-W01");
    expect(years).toEqual(["2024", "2025"]);
  });
});

describe("weekToMonth / weekToQuarter / weekToYear UTC consistency", () => {
  it("weekToMonth returns correct month for year-boundary week", () => {
    expect(weekToMonth("2026-W01")).toBe("2025-12");
  });

  it("weekToQuarter returns correct quarter for year-boundary week", () => {
    expect(weekToQuarter("2026-W01")).toBe("2025-Q4");
  });

  it("weekToYear returns correct year for year-boundary week", () => {
    expect(weekToYear("2026-W01")).toBe("2025");
  });
});
