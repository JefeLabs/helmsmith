import { describe, it, expect, beforeAll } from "vitest";
import chalk from "chalk";
import { sparkline } from "../ui/sparkline.js";
import { stripAnsi } from "../ui/format.js";

// Force chalk colors on in test environment
beforeAll(() => {
  chalk.level = 3;
});

describe("sparkline", () => {
  it("renders proportional sparkline characters for normal values", () => {
    const result = sparkline([0, 25, 50, 75, 100]);
    expect(result).toHaveLength(5);
    // First char should be lowest bar, last should be highest
    expect(result[0]).toBe("\u2581"); // ▁
    expect(result[4]).toBe("\u2588"); // █
  });

  it("returns empty string for empty array", () => {
    expect(sparkline([])).toBe("");
  });

  it("renders mid-height bar for single value", () => {
    const result = sparkline([42]);
    expect(result).toHaveLength(1);
    // Single value should be mid-height
    expect(result[0]).toBe("\u2584"); // ▄
  });

  it("renders all same height for identical values", () => {
    const result = sparkline([5, 5, 5, 5]);
    expect(result).toHaveLength(4);
    // All same value — all mid-height
    const uniqueChars = new Set(result.split(""));
    expect(uniqueChars.size).toBe(1);
    expect(result[0]).toBe("\u2584"); // ▄
  });

  it("applies color function when provided", () => {
    const result = sparkline([0, 50, 100], { color: chalk.green });
    // The ANSI codes should be present
    expect(result).toContain("\x1b[");
    // Strip ANSI to verify content
    const plain = stripAnsi(result);
    expect(plain).toHaveLength(3);
  });

  it("handles large value ranges", () => {
    const result = sparkline([0, 1000000]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("\u2581"); // ▁ (lowest)
    expect(result[1]).toBe("\u2588"); // █ (highest)
  });

  it("handles negative to positive range", () => {
    const result = sparkline([-100, 0, 100]);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("\u2581"); // lowest
    expect(result[2]).toBe("\u2588"); // highest
  });

  it("renders intermediate heights correctly", () => {
    // With 8 spark chars, evenly spaced values should map to different heights
    const result = sparkline([0, 14, 29, 43, 57, 71, 86, 100]);
    expect(result).toHaveLength(8);
    // Each character should be different (or very close neighbors)
    // The first should be the lowest and last the highest
    expect(result[0]).toBe("\u2581");
    expect(result[7]).toBe("\u2588");
  });
});
