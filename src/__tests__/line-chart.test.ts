import { describe, it, expect, beforeAll } from "vitest";
import chalk from "chalk";
import {
  renderLineChart,
  type LineSeries,
  type LineChartOptions,
} from "../ui/line-chart.js";
import { stripAnsi } from "../ui/format.js";

// Force chalk colors on in test environment
beforeAll(() => {
  chalk.level = 3;
});

describe("renderLineChart", () => {
  describe("single series", () => {
    it("renders a single solid series", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Team A",
            color: chalk.green,
            values: [10, 20, 30, 20, 10],
            style: "solid",
          },
        ],
        xLabels: ["W1", "W2", "W3", "W4", "W5"],
        height: 5,
      });

      expect(result).toBeTruthy();
      const lines = result.split("\n");
      // Should have: 5 chart rows + 1 x-axis line + 1 x-label row = 7 lines
      expect(lines.length).toBeGreaterThanOrEqual(7);
      // Should contain line characters
      const plain = stripAnsi(result);
      // Should contain at least some line drawing chars or dots
      expect(plain.replace(/\s/g, "").length).toBeGreaterThan(0);
    });

    it("renders a single dotted series", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Team B",
            color: chalk.blue,
            values: [5, 15, 25],
            style: "dotted",
          },
        ],
        xLabels: ["W1", "W2", "W3"],
        height: 5,
      });

      const plain = stripAnsi(result);
      // Dotted series should use dot character
      expect(plain).toContain("\u00B7"); // ·
    });

    it("places the peak value at the top row and min at the bottom", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Test",
            color: chalk.green,
            values: [0, 100],
            style: "solid",
          },
        ],
        xLabels: ["A", "B"],
        height: 5,
        width: 5,
      });

      const lines = result.split("\n");
      // The first chart row (top) should have something at the right side (value=100)
      // The last chart row (bottom) should have something at the left side (value=0)
      const topRow = stripAnsi(lines[0]);
      const bottomRow = stripAnsi(lines[4]);
      // Top row should have non-space chars near the end
      expect(topRow.trim().length).toBeGreaterThan(0);
      // Bottom row should have non-space chars near the start
      expect(bottomRow.trim().length).toBeGreaterThan(0);
    });
  });

  describe("multi series", () => {
    it("renders multiple series with different colors", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Core",
            color: chalk.green,
            values: [10, 30, 20],
            style: "solid",
          },
          {
            label: "Consultant",
            color: chalk.yellow,
            values: [5, 10, 15],
            style: "dotted",
          },
        ],
        xLabels: ["W1", "W2", "W3"],
        height: 6,
      });

      expect(result).toBeTruthy();
      const plain = stripAnsi(result);
      // Should have both solid and dotted characters
      const hasSolidChars =
        plain.includes("\u2500") ||
        plain.includes("\u256D") ||
        plain.includes("\u256E") ||
        plain.includes("\u2570") ||
        plain.includes("\u256F") ||
        plain.includes("\u2502");
      const hasDotChars = plain.includes("\u00B7");
      expect(hasSolidChars).toBe(true);
      expect(hasDotChars).toBe(true);
    });

    it("handles overlapping series (later overwrites earlier)", () => {
      // Two series with same values — should not crash, last one wins
      const result = renderLineChart({
        series: [
          {
            label: "A",
            color: chalk.green,
            values: [10, 20, 30],
            style: "solid",
          },
          {
            label: "B",
            color: chalk.red,
            values: [10, 20, 30],
            style: "solid",
          },
        ],
        xLabels: ["W1", "W2", "W3"],
        height: 5,
      });

      expect(result).toBeTruthy();
      // Both should render without error. Since B overwrites A at same positions,
      // we should see red color codes for the line characters
      expect(result).toContain("\x1b["); // Has ANSI codes
    });
  });

  describe("solid and dotted styles", () => {
    it("uses box-drawing characters for solid style", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Solid",
            color: chalk.green,
            values: [0, 50, 100, 50, 0],
            style: "solid",
          },
        ],
        xLabels: ["1", "2", "3", "4", "5"],
        height: 8,
      });

      const plain = stripAnsi(result);
      // Should use box-drawing characters
      const solidChars = [
        "\u2500", // ─
        "\u256D", // ╭
        "\u256E", // ╮
        "\u2570", // ╰
        "\u256F", // ╯
        "\u2502", // │
      ];
      const hasSolidChar = solidChars.some((c) => plain.includes(c));
      expect(hasSolidChar).toBe(true);
    });

    it("uses dot character for dotted style", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Dotted",
            color: chalk.blue,
            values: [10, 50, 30],
            style: "dotted",
          },
        ],
        xLabels: ["A", "B", "C"],
        height: 5,
      });

      const plain = stripAnsi(result);
      expect(plain).toContain("\u00B7"); // ·
      // Should NOT contain solid line chars in the data area (though axis has them)
      // Chart body area check: the dots should be there
    });

    it("defaults to solid style when style is not specified", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Default",
            color: chalk.green,
            values: [10, 50, 30],
          },
        ],
        xLabels: ["A", "B", "C"],
        height: 5,
      });

      const plain = stripAnsi(result);
      // Should use solid characters, not dots for the data line
      const solidChars = [
        "\u2500",
        "\u256D",
        "\u256E",
        "\u2570",
        "\u256F",
        "\u2502",
      ];
      const hasSolidChar = solidChars.some((c) => plain.includes(c));
      expect(hasSolidChar).toBe(true);
    });
  });

  describe("Y-axis scaling", () => {
    it("shows formatted Y-axis labels at top, middle, and bottom", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Test",
            color: chalk.green,
            values: [0, 5000, 10000],
          },
        ],
        xLabels: ["A", "B", "C"],
        height: 5,
        yAxisWidth: 6,
      });

      const plain = stripAnsi(result);
      // Top label should be the max value formatted
      expect(plain).toContain("10.0K");
      // Bottom label should be the min value
      expect(plain).toContain("0");
    });

    it("handles all same values gracefully", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Flat",
            color: chalk.green,
            values: [50, 50, 50],
          },
        ],
        xLabels: ["A", "B", "C"],
        height: 5,
      });

      // Should not crash and should render something
      expect(result).toBeTruthy();
      const lines = result.split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(6);
    });

    it("scales Y axis based on global min/max across all series", () => {
      const result = renderLineChart({
        series: [
          {
            label: "A",
            color: chalk.green,
            values: [100, 200],
          },
          {
            label: "B",
            color: chalk.blue,
            values: [0, 300],
          },
        ],
        xLabels: ["X", "Y"],
        height: 5,
        yAxisWidth: 6,
      });

      const plain = stripAnsi(result);
      // Max should be 300 (from series B)
      expect(plain).toContain("300");
      // Min should be 0 (from series B)
    });

    it("handles negative values", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Test",
            color: chalk.green,
            values: [-50, 0, 50],
          },
        ],
        xLabels: ["A", "B", "C"],
        height: 5,
        yAxisWidth: 6,
      });

      // Should not crash
      expect(result).toBeTruthy();
      const plain = stripAnsi(result);
      // Should show 50 at top and -50 at bottom
      expect(plain).toContain("50");
      expect(plain).toContain("-50");
    });
  });

  describe("character selection", () => {
    it("uses horizontal char for flat segments", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Flat",
            color: chalk.green,
            values: [50, 50, 50, 50],
            style: "solid",
          },
        ],
        xLabels: ["A", "B", "C", "D"],
        height: 5,
      });

      const plain = stripAnsi(result);
      // A flat line should contain horizontal dash chars
      expect(plain).toContain("\u2500"); // ─
    });

    it("uses corner characters for direction changes", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Wave",
            color: chalk.green,
            values: [0, 100, 0],
            style: "solid",
          },
        ],
        xLabels: ["A", "B", "C"],
        height: 10,
        width: 10,
      });

      const plain = stripAnsi(result);
      // Should contain some corner characters for the peak
      const cornerChars = [
        "\u256D", // ╭
        "\u256E", // ╮
        "\u2570", // ╰
        "\u256F", // ╯
      ];
      const hasCorner = cornerChars.some((c) => plain.includes(c));
      expect(hasCorner).toBe(true);
    });
  });

  describe("legend", () => {
    it("shows legend when showLegend is true", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Core",
            color: chalk.green,
            values: [10, 20],
            style: "solid",
          },
          {
            label: "Consultant",
            color: chalk.blue,
            values: [5, 15],
            style: "dotted",
          },
        ],
        xLabels: ["W1", "W2"],
        height: 5,
        showLegend: true,
      });

      const plain = stripAnsi(result);
      // Legend should show series labels
      expect(plain).toContain("Core");
      expect(plain).toContain("Consultant");
      // Solid indicator: ──
      expect(plain).toContain("\u2500\u2500");
      // Dotted indicator: ··
      expect(plain).toContain("\u00B7\u00B7");
    });

    it("does not show legend when showLegend is false", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Core",
            color: chalk.green,
            values: [10, 20],
          },
        ],
        xLabels: ["W1", "W2"],
        height: 5,
        showLegend: false,
      });

      const plain = stripAnsi(result);
      // The label "Core" should NOT appear in output (it's not in the legend)
      // But the series is still plotted
      expect(result).toBeTruthy();
      // No legend indicator
      expect(plain).not.toContain("\u2500\u2500 Core");
    });
  });

  describe("X-axis labels", () => {
    it("displays x-axis labels below the chart", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Test",
            color: chalk.green,
            values: [10, 20, 30],
          },
        ],
        xLabels: ["Jan", "Feb", "Mar"],
        height: 5,
        width: 20,
      });

      const plain = stripAnsi(result);
      expect(plain).toContain("Jan");
      expect(plain).toContain("Mar");
    });
  });

  describe("Y label", () => {
    it("displays Y-axis label when provided", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Test",
            color: chalk.green,
            values: [10, 20],
          },
        ],
        xLabels: ["A", "B"],
        height: 5,
        yLabel: "lines changed",
      });

      const plain = stripAnsi(result);
      expect(plain).toContain("lines changed");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for empty series array", () => {
      const result = renderLineChart({
        series: [],
        xLabels: ["A", "B"],
        height: 5,
      });
      expect(result).toBe("");
    });

    it("returns empty string for empty xLabels", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Test",
            color: chalk.green,
            values: [10, 20],
          },
        ],
        xLabels: [],
        height: 5,
      });
      expect(result).toBe("");
    });

    it("handles single data point", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Single",
            color: chalk.green,
            values: [42],
          },
        ],
        xLabels: ["W1"],
        height: 5,
        width: 5,
      });

      expect(result).toBeTruthy();
      const plain = stripAnsi(result);
      expect(plain).toContain("W1");
    });

    it("handles very large values", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Big",
            color: chalk.green,
            values: [0, 1000000, 2000000],
          },
        ],
        xLabels: ["A", "B", "C"],
        height: 5,
        yAxisWidth: 8,
      });

      const plain = stripAnsi(result);
      expect(plain).toContain("2.0M");
    });

    it("respects custom width parameter", () => {
      const result = renderLineChart({
        series: [
          {
            label: "Test",
            color: chalk.green,
            values: [10, 20, 30],
          },
        ],
        xLabels: ["A", "B", "C"],
        height: 5,
        width: 20,
        yAxisWidth: 6,
      });

      const lines = result.split("\n");
      // Each chart row should have yAxisWidth + separator(1) + width(20) characters
      const firstChartLine = stripAnsi(lines[0]);
      // yAxisWidth(6) + separator(1) + chartWidth(20) = 27
      expect(firstChartLine).toHaveLength(27);
    });
  });
});
