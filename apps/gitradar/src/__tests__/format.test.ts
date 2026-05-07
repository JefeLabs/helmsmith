import { describe, it, expect, beforeAll } from "vitest";
import chalk from "chalk";
import {
  fmt,
  delta,
  weekLabel,
  weekShort,
  stripAnsi,
  padRight,
  padLeft,
} from "../ui/format.js";

// Force chalk colors on in test environment
beforeAll(() => {
  chalk.level = 3;
});

describe("fmt", () => {
  it("formats numbers below 1000 as-is", () => {
    expect(fmt(0)).toBe("0");
    expect(fmt(1)).toBe("1");
    expect(fmt(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(fmt(1000)).toBe("1.0K");
    expect(fmt(1234)).toBe("1.2K");
    expect(fmt(1250)).toBe("1.3K");
    expect(fmt(9999)).toBe("10.0K");
    expect(fmt(15100)).toBe("15.1K");
    expect(fmt(999999)).toBe("1000.0K");
  });

  it("formats millions with M suffix", () => {
    expect(fmt(1000000)).toBe("1.0M");
    expect(fmt(1234567)).toBe("1.2M");
    expect(fmt(12500000)).toBe("12.5M");
  });

  it("handles negative numbers", () => {
    expect(fmt(-500)).toBe("-500");
    expect(fmt(-1234)).toBe("-1.2K");
    expect(fmt(-1234567)).toBe("-1.2M");
  });
});

describe("delta", () => {
  it("shows green up arrow for increase", () => {
    const result = delta(112, 100);
    expect(stripAnsi(result)).toBe("\u25B2 12%");
    // Verify it contains green ANSI codes
    expect(result).toContain("\x1b[");
  });

  it("shows red down arrow for decrease", () => {
    const result = delta(92, 100);
    expect(stripAnsi(result)).toBe("\u25BC 8%");
  });

  it("shows dim dash for no change", () => {
    const result = delta(100, 100);
    expect(stripAnsi(result)).toBe("\u2500 0%");
  });

  it("shows dim dash when both are zero", () => {
    const result = delta(0, 0);
    expect(stripAnsi(result)).toBe("\u2500 0%");
  });

  it('shows "new" when previous is zero but current is not', () => {
    const result = delta(100, 0);
    expect(stripAnsi(result)).toBe("\u25B2 new");
  });

  it("rounds percentage to nearest integer", () => {
    const result = delta(103, 100);
    expect(stripAnsi(result)).toBe("\u25B2 3%");
  });
});

describe("weekLabel", () => {
  it("converts ISO week to month + day of Monday", () => {
    // 2026-W08: Monday is Feb 16, 2026
    const result = weekLabel("2026-W08");
    expect(result).toMatch(/^Feb \d+$/);
  });

  it("converts first week of year", () => {
    const result = weekLabel("2026-W01");
    // W01 of 2026 starts on Mon Dec 29, 2025
    expect(result).toMatch(/^(Dec|Jan) \d+$/);
  });

  it("returns input unchanged for invalid format", () => {
    expect(weekLabel("not-a-week")).toBe("not-a-week");
    expect(weekLabel("2026-08")).toBe("2026-08");
  });
});

describe("weekShort", () => {
  it('extracts week number from ISO week string', () => {
    expect(weekShort("2026-W08")).toBe("W08");
    expect(weekShort("2026-W01")).toBe("W01");
    expect(weekShort("2026-W52")).toBe("W52");
  });

  it("returns input unchanged for invalid format", () => {
    expect(weekShort("not-a-week")).toBe("not-a-week");
  });
});

describe("stripAnsi", () => {
  it("removes ANSI escape codes", () => {
    const colored = chalk.green("hello");
    expect(stripAnsi(colored)).toBe("hello");
  });

  it("removes multiple nested ANSI codes", () => {
    const colored = chalk.bold(chalk.red("test"));
    expect(stripAnsi(colored)).toBe("test");
  });

  it("returns plain strings unchanged", () => {
    expect(stripAnsi("hello")).toBe("hello");
    expect(stripAnsi("")).toBe("");
  });
});

describe("padRight", () => {
  it("pads plain strings to given width", () => {
    expect(padRight("hi", 5)).toBe("hi   ");
  });

  it("pads ANSI-colored strings based on visible length", () => {
    const colored = chalk.green("hi");
    const padded = padRight(colored, 5);
    // The visible content should be 5 chars
    expect(stripAnsi(padded)).toBe("hi   ");
  });

  it("returns string as-is if already at or beyond width", () => {
    expect(padRight("hello", 5)).toBe("hello");
    expect(padRight("hello world", 5)).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(padRight("", 3)).toBe("   ");
  });
});

describe("padLeft", () => {
  it("pads plain strings to given width on the left", () => {
    expect(padLeft("hi", 5)).toBe("   hi");
  });

  it("pads ANSI-colored strings based on visible length", () => {
    const colored = chalk.green("hi");
    const padded = padLeft(colored, 5);
    expect(stripAnsi(padded)).toBe("   hi");
  });

  it("returns string as-is if already at or beyond width", () => {
    expect(padLeft("hello", 5)).toBe("hello");
    expect(padLeft("hello world", 5)).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(padLeft("", 3)).toBe("   ");
  });
});
