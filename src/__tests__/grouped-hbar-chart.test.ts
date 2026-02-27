import { describe, it, expect, beforeAll } from "vitest";
import chalk from "chalk";
import {
  renderGroupedHBarChart,
  type HBar,
  type HBarGroup,
  type SegmentDef,
  type GroupedHBarChartOptions,
} from "../ui/grouped-hbar-chart.js";
import { stripAnsi } from "../ui/format.js";

// Force chalk colors on in test environment
beforeAll(() => {
  chalk.level = 3;
});

const segmentDefs: SegmentDef[] = [
  { key: "app", label: "app", char: "\u2588", color: chalk.green },
  { key: "test", label: "test", char: "\u2593", color: chalk.blue },
  { key: "config", label: "config", char: "\u2591", color: chalk.yellow },
  {
    key: "storybook",
    label: "storybook",
    char: "\u2592",
    color: chalk.magenta,
  },
];

function makeBar(
  label: string,
  values: { app?: number; test?: number; config?: number; storybook?: number },
  orgType?: "core" | "consultant"
): HBar {
  const segments = [
    { key: "app", value: values.app ?? 0 },
    { key: "test", value: values.test ?? 0 },
    { key: "config", value: values.config ?? 0 },
    { key: "storybook", value: values.storybook ?? 0 },
  ];
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return { label, segments, total, orgType };
}

describe("renderGroupedHBarChart", () => {
  it("renders a single group with one bar", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Team A", { app: 1000, test: 200 })],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 80,
    });
    const plain = stripAnsi(result);

    // Should contain group label
    expect(plain).toContain("W12");
    // Should contain the axis char
    expect(plain).toContain("\u2524");
    // Should contain bar characters
    expect(plain).toContain("\u2588"); // app char
    expect(plain).toContain("\u2593"); // test char
    // Should contain the formatted value
    expect(plain).toContain("1.2K");
  });

  it("renders multiple groups with multiple bars", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W10",
        bars: [
          makeBar("Team A", { app: 1500, test: 300, config: 100 }),
          makeBar("Team B", { app: 800, test: 100 }),
        ],
      },
      {
        groupLabel: "W11",
        bars: [
          makeBar("Team A", { app: 1700, test: 400, config: 200 }),
          makeBar("Team B", { app: 900, test: 150 }),
        ],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 100,
    });
    const lines = result.split("\n");

    // Should have lines for both groups
    const plain = stripAnsi(result);
    expect(plain).toContain("W10");
    expect(plain).toContain("W11");

    // First bar of each group should have the axis char
    const w10Line = lines.find((l) => stripAnsi(l).includes("W10"));
    expect(w10Line).toBeDefined();
    expect(stripAnsi(w10Line!)).toContain("\u2524");

    // Second bar should be indented with pipe
    const teamBLines = lines.filter((l) =>
      stripAnsi(l).includes("Team B")
    );
    expect(teamBLines.length).toBe(2);
    for (const line of teamBLines) {
      expect(stripAnsi(line)).toContain("\u2502");
    }
  });

  it("renders segment proportions correctly", () => {
    // 75% app, 25% test
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Team A", { app: 750, test: 250 })],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 100,
      showValues: false,
    });
    const plain = stripAnsi(result);

    // Count segment characters in the bar portion
    const barLine = plain.split("\n")[0];
    const appChars = barLine.split("").filter((c) => c === "\u2588").length;
    const testChars = barLine.split("").filter((c) => c === "\u2593").length;

    // Total bar should fill the bar area (total = 1000 = globalMax, so full width)
    const totalChars = appChars + testChars;
    expect(totalChars).toBeGreaterThan(0);

    // app should be ~75% of bar, test ~25%
    const appRatio = appChars / totalChars;
    expect(appRatio).toBeGreaterThan(0.6);
    expect(appRatio).toBeLessThan(0.9);
  });

  it("renders dashed separator after specified bar indices", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [
          makeBar("Platform", { app: 500 }, "core"),
          makeBar("Product", { app: 800 }, "core"),
          makeBar("Mobile", { app: 300 }, "core"),
          makeBar("FrontSquad", { app: 400 }, "consultant"),
        ],
        separatorAfter: [2],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 100,
    });
    const lines = result.split("\n");
    const plainLines = lines.map((l) => stripAnsi(l));

    // Find the separator line (contains dashes)
    const separatorLine = plainLines.find((l) => l.includes("\u2500 \u2500"));
    expect(separatorLine).toBeDefined();

    // Separator should appear after the 3rd bar (index 2) but before the 4th
    const mobileIndex = plainLines.findIndex((l) => l.includes("Mobile"));
    const separatorIndex = plainLines.findIndex((l) =>
      l.includes("\u2500 \u2500")
    );
    const frontSquadIndex = plainLines.findIndex((l) =>
      l.includes("FrontSquad")
    );

    expect(separatorIndex).toBeGreaterThan(mobileIndex);
    expect(separatorIndex).toBeLessThan(frontSquadIndex);
  });

  it("renders core prefix with star", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Platform", { app: 500 }, "core")],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 100,
    });
    const plain = stripAnsi(result);
    expect(plain).toContain("\u2605 Platform");
  });

  it("renders consultant prefix with diamond", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("FrontSquad", { app: 500 }, "consultant")],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 100,
    });
    const plain = stripAnsi(result);
    expect(plain).toContain("\u25C6 FrontSquad");
  });

  it("displays formatted values right of bars when showValues is true", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [
          makeBar("Team A", { app: 15100 }),
          makeBar("Team B", { app: 4400 }),
        ],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      showValues: true,
      maxBarWidth: 40,
      maxWidth: 100,
    });
    const plain = stripAnsi(result);
    expect(plain).toContain("15.1K");
    expect(plain).toContain("4.4K");
  });

  it("hides values when showValues is false", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Team A", { app: 15100 })],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      showValues: false,
      maxBarWidth: 40,
      maxWidth: 100,
    });
    const plain = stripAnsi(result);
    expect(plain).not.toContain("15.1K");
  });

  it("returns empty string for empty groups", () => {
    const result = renderGroupedHBarChart({
      groups: [],
      segmentDefs,
    });
    expect(result).toBe("");
  });

  it("handles bars with all-zero segments", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Team A", {})],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 100,
    });
    const plain = stripAnsi(result);
    // Should still render the label and group
    expect(plain).toContain("W12");
    expect(plain).toContain("Team A");
    // Value should show 0
    expect(plain).toContain("0");
  });

  it("ensures non-zero segments get minimum 1 char", () => {
    // One huge segment and one tiny one
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [
          makeBar("Team A", { app: 10000, storybook: 1 }),
        ],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 100,
    });
    const plain = stripAnsi(result);
    // The storybook char should appear at least once
    expect(plain).toContain("\u2592");
  });

  it("scales bars proportionally to globalMax", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [
          makeBar("Big", { app: 1000 }),
          makeBar("Small", { app: 500 }),
        ],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 100,
      showValues: false,
    });
    const lines = result.split("\n");
    const plainLines = lines.map((l) => stripAnsi(l));

    const bigLine = plainLines.find((l) => l.includes("Big"))!;
    const smallLine = plainLines.find((l) => l.includes("Small"))!;

    const bigBarChars = bigLine
      .split("")
      .filter((c) => c === "\u2588").length;
    const smallBarChars = smallLine
      .split("")
      .filter((c) => c === "\u2588").length;

    // Big should be approximately 2x the small bar
    expect(bigBarChars).toBeGreaterThan(smallBarChars);
    // The ratio should be roughly 2:1
    const ratio = bigBarChars / smallBarChars;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });

  it("adds blank line between groups", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W10",
        bars: [makeBar("Team A", { app: 100 })],
      },
      {
        groupLabel: "W11",
        bars: [makeBar("Team A", { app: 100 })],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 100,
    });
    const lines = result.split("\n");
    const plainLines = lines.map((l) => stripAnsi(l));

    // There should be a blank (pipe-only) line between the two groups
    const w10Index = plainLines.findIndex((l) => l.includes("W10"));
    const w11Index = plainLines.findIndex((l) => l.includes("W11"));
    expect(w11Index).toBeGreaterThan(w10Index + 1);
    // The line between should contain only whitespace and pipe
    const betweenLine = plainLines[w10Index + 1];
    expect(betweenLine.trim()).toMatch(/^\u2502?$/);
  });

  it("shows ▲ indicator when insertions are above avg", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Team A", { app: 2000 })],
      },
    ];
    groups[0].bars[0].insertions = 1800;
    groups[0].bars[0].deletions = 200;
    groups[0].bars[0].avgInsertions = 1000;
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 120,
    });
    const plain = stripAnsi(result);
    expect(plain).toContain("\u25B2");
  });

  it("shows ▼ indicator when insertions are below avg", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Team A", { app: 500 })],
      },
    ];
    groups[0].bars[0].insertions = 300;
    groups[0].bars[0].deletions = 200;
    groups[0].bars[0].avgInsertions = 1000;
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 120,
    });
    const plain = stripAnsi(result);
    expect(plain).toContain("\u25BC");
  });

  it("shows no indicator when avgInsertions is not set", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Team A", { app: 1000 })],
      },
    ];
    groups[0].bars[0].insertions = 800;
    groups[0].bars[0].deletions = 200;
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 120,
    });
    const plain = stripAnsi(result);
    expect(plain).not.toContain("\u25B2");
    expect(plain).not.toContain("\u25BC");
  });

  it("shows ▲/▼ for net column when avgNet is set", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Team A", { app: 2000 })],
      },
    ];
    groups[0].bars[0].insertions = 1800;
    groups[0].bars[0].deletions = 200;
    // net = 1600, avgNet = 500 → above avg → ▲
    groups[0].bars[0].avgNet = 500;
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 120,
    });
    const plain = stripAnsi(result);
    // Should have at least one ▲ (from net)
    expect(plain).toContain("\u25B2");
  });

  it("shows headcount and per-user averages when set", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Team A", { app: 1000 })],
      },
    ];
    groups[0].bars[0].insertions = 700;
    groups[0].bars[0].deletions = 300;
    groups[0].bars[0].headcount = 7;
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 140,
    });
    const plain = stripAnsi(result);
    expect(plain).toContain("(7)");
    // per-user: +700/7=100, -300/7≈43
    expect(plain).toContain("+100");
    expect(plain).toContain("-43");
  });

  it("omits headcount when not set", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Team A", { app: 1000 })],
      },
    ];
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 100,
    });
    const plain = stripAnsi(result);
    // Should not contain parenthesized number
    expect(plain).not.toMatch(/\(\d+\)/);
  });

  it("shows separate +ins and -del columns when insertions/deletions provided", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [makeBar("Team A", { app: 5000, test: 1000 })],
      },
    ];
    groups[0].bars[0].insertions = 4200;
    groups[0].bars[0].deletions = 1800;
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 120,
    });
    const plain = stripAnsi(result);
    expect(plain).toContain("+4.2K");
    expect(plain).toContain("-1.8K");
    // Net column: 4200 - 1800 = 2400
    expect(plain).toContain("+2.4K");
  });

  it("aligns value columns across bars of different widths", () => {
    const groups: HBarGroup[] = [
      {
        groupLabel: "W12",
        bars: [
          makeBar("Big Team", { app: 8000 }),
          makeBar("Small Team", { app: 2000 }),
        ],
      },
    ];
    groups[0].bars[0].insertions = 5000;
    groups[0].bars[0].deletions = 3000;
    groups[0].bars[1].insertions = 1200;
    groups[0].bars[1].deletions = 800;
    const result = renderGroupedHBarChart({
      groups,
      segmentDefs,
      maxBarWidth: 40,
      maxWidth: 120,
    });
    const lines = result.split("\n");
    const plainLines = lines.map((l) => stripAnsi(l));

    // Find the "+" column position in each line — they should align
    const bigLine = plainLines.find((l) => l.includes("Big Team"))!;
    const smallLine = plainLines.find((l) => l.includes("Small Team"))!;
    const bigPlusPos = bigLine.indexOf("+");
    const smallPlusPos = smallLine.indexOf("+");
    expect(bigPlusPos).toBe(smallPlusPos);
  });
});
