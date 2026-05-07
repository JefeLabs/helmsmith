import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import chalk from "chalk";
import { renderBanner } from "../ui/banner.js";
import { stripAnsi } from "../ui/format.js";

// Force chalk colors on in test environment
beforeAll(() => {
  chalk.level = 3;
});

describe("renderBanner", () => {
  let originalColumns: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
    // Set a known width for consistent testing
    Object.defineProperty(process.stdout, "columns", {
      value: 80,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "columns", {
      value: originalColumns,
      writable: true,
      configurable: true,
    });
  });

  it("renders title in bold", () => {
    const result = renderBanner({ title: "Dashboard" });
    const plain = stripAnsi(result);
    expect(plain).toContain("Dashboard");
    // Should have ANSI bold codes
    expect(result).toContain("\x1b[");
  });

  it("renders subtitle on second line", () => {
    const result = renderBanner({
      title: "Dashboard",
      subtitle: "Last 12 weeks",
    });
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(stripAnsi(lines[1])).toContain("Last 12 weeks");
  });

  it("renders right-aligned text", () => {
    const result = renderBanner({
      title: "Dashboard",
      right: "W01 - W12",
    });
    const lines = result.split("\n");
    const firstLine = stripAnsi(lines[0]);
    expect(firstLine).toContain("Dashboard");
    expect(firstLine).toContain("W01 - W12");
    // The right text should be after the title with gap
    const titleIdx = firstLine.indexOf("Dashboard");
    const rightIdx = firstLine.indexOf("W01 - W12");
    expect(rightIdx).toBeGreaterThan(titleIdx);
  });

  it("renders right sub text below right text", () => {
    const result = renderBanner({
      title: "Dashboard",
      right: "W01 - W12",
      subtitle: "All Orgs",
      rightSub: "12 weeks",
    });
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(stripAnsi(lines[1])).toContain("12 weeks");
    expect(stripAnsi(lines[1])).toContain("All Orgs");
  });

  it("renders a separator line", () => {
    const result = renderBanner({ title: "Test" });
    const lines = result.split("\n");
    const lastLine = stripAnsi(lines[lines.length - 1]);
    // Should be a line of horizontal dash characters
    expect(lastLine).toMatch(/^[\u2500]+$/);
    expect(lastLine.length).toBeGreaterThan(0);
  });

  it("handles title-only rendering", () => {
    const result = renderBanner({ title: "Simple" });
    const lines = result.split("\n");
    // Title line + separator line
    expect(lines).toHaveLength(2);
    expect(stripAnsi(lines[0])).toContain("Simple");
  });
});
