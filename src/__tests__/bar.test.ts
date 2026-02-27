import { describe, it, expect } from "vitest";
import chalk from "chalk";
import { stackedBar } from "../ui/bar.js";
import { stripAnsi } from "../ui/format.js";

describe("stackedBar", () => {
  const green = chalk.green;
  const blue = chalk.blue;
  const yellow = chalk.yellow;
  const magenta = chalk.magenta;

  it("renders proportional segments", () => {
    const result = stackedBar(
      [
        { value: 75, color: green, char: "\u2588" },
        { value: 25, color: blue, char: "\u2593" },
      ],
      20
    );
    const plain = stripAnsi(result);
    expect(plain).toHaveLength(20);
    // 75% of 20 = 15 green chars, 25% of 20 = 5 blue chars
    const greenCount = plain.split("").filter((c) => c === "\u2588").length;
    const blueCount = plain.split("").filter((c) => c === "\u2593").length;
    expect(greenCount).toBe(15);
    expect(blueCount).toBe(5);
  });

  it("gives minimum 1 char to segments with value > 0", () => {
    const result = stackedBar(
      [
        { value: 99, color: green, char: "\u2588" },
        { value: 1, color: blue, char: "\u2593" },
      ],
      10
    );
    const plain = stripAnsi(result);
    expect(plain).toHaveLength(10);
    // The small segment should have at least 1 char
    const blueCount = plain.split("").filter((c) => c === "\u2593").length;
    expect(blueCount).toBeGreaterThanOrEqual(1);
  });

  it("returns exact width characters", () => {
    const widths = [10, 20, 40, 60, 80];
    for (const width of widths) {
      const result = stackedBar(
        [
          { value: 50, color: green, char: "\u2588" },
          { value: 30, color: blue, char: "\u2593" },
          { value: 15, color: yellow, char: "\u2591" },
          { value: 5, color: magenta, char: "\u2592" },
        ],
        width
      );
      const plain = stripAnsi(result);
      expect(plain).toHaveLength(width);
    }
  });

  it("returns spaces for all-zero values", () => {
    const result = stackedBar(
      [
        { value: 0, color: green, char: "\u2588" },
        { value: 0, color: blue, char: "\u2593" },
      ],
      10
    );
    expect(result).toBe("          ");
  });

  it("handles single segment", () => {
    const result = stackedBar(
      [{ value: 100, color: green, char: "\u2588" }],
      15
    );
    const plain = stripAnsi(result);
    expect(plain).toHaveLength(15);
    expect(plain).toBe("\u2588".repeat(15));
  });

  it("returns empty string for zero width", () => {
    const result = stackedBar(
      [{ value: 100, color: green, char: "\u2588" }],
      0
    );
    expect(result).toBe("");
  });

  it("skips segments with zero value", () => {
    const result = stackedBar(
      [
        { value: 50, color: green, char: "\u2588" },
        { value: 0, color: blue, char: "\u2593" },
        { value: 50, color: yellow, char: "\u2591" },
      ],
      10
    );
    const plain = stripAnsi(result);
    expect(plain).toHaveLength(10);
    // No blue chars should appear
    const blueCount = plain.split("").filter((c) => c === "\u2593").length;
    expect(blueCount).toBe(0);
  });

  it("handles many small segments that each need minimum 1 char", () => {
    const segments = Array.from({ length: 5 }, (_, i) => ({
      value: 1,
      color: green,
      char: String(i),
    }));
    const result = stackedBar(segments, 10);
    const plain = stripAnsi(result);
    expect(plain).toHaveLength(10);
    // Each segment should have at least 1 char (5 segments each get 2 chars)
    for (let i = 0; i < 5; i++) {
      expect(plain).toContain(String(i));
    }
  });
});
