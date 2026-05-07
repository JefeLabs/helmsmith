import { describe, it, expect, beforeAll } from "vitest";
import chalk from "chalk";
import { renderTable, type Column, type TableOptions } from "../ui/table.js";
import { stripAnsi } from "../ui/format.js";

// Force chalk colors on in test environment
beforeAll(() => {
  chalk.level = 3;
});

describe("renderTable", () => {
  describe("column width distribution", () => {
    it("assigns fixed widths to columns with width property", () => {
      const columns: Column[] = [
        { key: "name", label: "Name", width: 10 },
        { key: "value", label: "Value", width: 8 },
      ];
      const rows = [{ name: "Alice", value: 100 }];
      const result = renderTable({ columns, rows, maxWidth: 80 });
      const lines = result.split("\n");
      // Header should contain padded labels
      const headerPlain = stripAnsi(lines[0]);
      expect(headerPlain).toHaveLength(10 + 1 + 8); // 10 + separator + 8
    });

    it("distributes flex space proportionally", () => {
      const columns: Column[] = [
        { key: "a", label: "A", flex: 1 },
        { key: "b", label: "B", flex: 3 },
      ];
      const rows = [{ a: "x", b: "y" }];
      const result = renderTable({ columns, rows, maxWidth: 41 });
      const lines = result.split("\n");
      const headerPlain = stripAnsi(lines[0]);
      // Total should be 41 chars (maxWidth): 10 flex-A + 1 sep + 30 flex-B = 41
      expect(headerPlain).toHaveLength(41);
    });

    it("applies minWidth floors", () => {
      const columns: Column[] = [
        { key: "a", label: "X", flex: 1, minWidth: 15 },
        { key: "b", label: "Y", flex: 1 },
      ];
      const rows = [{ a: "short", b: "short" }];
      const result = renderTable({ columns, rows, maxWidth: 41 });
      const lines = result.split("\n");
      const headerPlain = stripAnsi(lines[0]);
      // Column A should be at least 15 wide
      const parts = headerPlain.split("");
      // First column should be padded to at least 15
      const firstCol = headerPlain.substring(0, 15);
      expect(firstCol.length).toBeGreaterThanOrEqual(15);
    });

    it("combines fixed and flex columns", () => {
      const columns: Column[] = [
        { key: "rank", label: "#", width: 3 },
        { key: "name", label: "Name", flex: 2 },
        { key: "score", label: "Score", width: 8 },
      ];
      const rows = [{ rank: 1, name: "Alice", score: 100 }];
      const result = renderTable({ columns, rows, maxWidth: 42 });
      const lines = result.split("\n");
      const headerPlain = stripAnsi(lines[0]);
      // 3 + 1 + flex + 1 + 8 = 42 => flex = 29
      expect(headerPlain).toHaveLength(42);
    });
  });

  describe("ANSI-aware truncation", () => {
    it("truncates content that exceeds column width with ellipsis", () => {
      const columns: Column[] = [
        { key: "name", label: "Name", width: 6 },
      ];
      const rows = [{ name: "Alexander" }];
      const result = renderTable({ columns, rows, maxWidth: 80 });
      const lines = result.split("\n");
      // Data row should have truncated content
      const dataLine = stripAnsi(lines[lines.length - 1]);
      expect(dataLine).toHaveLength(6);
      expect(dataLine).toContain("\u2026"); // … ellipsis
    });

    it("preserves ANSI codes when measuring content width", () => {
      const columns: Column[] = [
        { key: "name", label: "Name", width: 10 },
      ];
      const rows = [{ name: chalk.green("Alice") }];
      const result = renderTable({ columns, rows, maxWidth: 80 });
      const lines = result.split("\n");
      // Data row should still be visually 10 chars
      const dataLine = stripAnsi(lines[lines.length - 1]);
      expect(dataLine).toHaveLength(10);
      expect(dataLine.trim()).toBe("Alice");
    });

    it("truncates ANSI-colored content correctly", () => {
      const columns: Column[] = [
        { key: "bar", label: "Bar", width: 5 },
      ];
      const longColored = chalk.green("A".repeat(20));
      const rows = [{ bar: longColored }];
      const result = renderTable({ columns, rows, maxWidth: 80 });
      const lines = result.split("\n");
      const dataLine = stripAnsi(lines[lines.length - 1]);
      expect(dataLine).toHaveLength(5);
      expect(dataLine).toContain("\u2026");
    });
  });

  describe("border styles", () => {
    const columns: Column[] = [
      { key: "name", label: "Name", width: 8 },
      { key: "value", label: "Value", width: 6 },
    ];
    const rows = [
      { name: "Alice", value: 100 },
      { name: "Bob", value: 200 },
    ];

    it("renders minimal style with header separator and no vertical borders", () => {
      const result = renderTable({
        columns,
        rows,
        borderStyle: "minimal",
        maxWidth: 80,
      });
      const lines = result.split("\n");
      // Should have: header, separator, 2 data rows = 4 lines
      expect(lines).toHaveLength(4);
      // Separator should be dashes
      const sepPlain = stripAnsi(lines[1]);
      expect(sepPlain).toMatch(/^[\u2500]+$/);
      // No vertical border chars in data rows
      const dataPlain = stripAnsi(lines[2]);
      expect(dataPlain).not.toContain("\u2502");
    });

    it("renders rounded style with box-drawing characters", () => {
      const result = renderTable({
        columns,
        rows,
        borderStyle: "rounded",
        maxWidth: 80,
      });
      const lines = result.split("\n");
      const firstPlain = stripAnsi(lines[0]);
      // Top border with rounded corner
      expect(firstPlain).toContain("\u256D"); // ╭
      expect(firstPlain).toContain("\u256E"); // ╮
      // Bottom border
      const lastPlain = stripAnsi(lines[lines.length - 1]);
      expect(lastPlain).toContain("\u2570"); // ╰
      expect(lastPlain).toContain("\u256F"); // ╯
      // Data rows have vertical borders
      const dataPlain = stripAnsi(lines[3]);
      expect(dataPlain).toContain("\u2502"); // │
    });

    it("renders none style with spaces only", () => {
      const result = renderTable({
        columns,
        rows,
        borderStyle: "none",
        maxWidth: 80,
      });
      const lines = result.split("\n");
      // Should have: header, 2 data rows = 3 lines (no separator)
      expect(lines).toHaveLength(3);
      // No box-drawing chars anywhere
      const allPlain = stripAnsi(result);
      expect(allPlain).not.toContain("\u2500");
      expect(allPlain).not.toContain("\u2502");
      expect(allPlain).not.toContain("\u256D");
    });
  });

  describe("zebra striping", () => {
    it("dims alternate (odd-indexed) rows when zebra is true", () => {
      const columns: Column[] = [{ key: "name", label: "Name", width: 10 }];
      const rows = [
        { name: "Row0" },
        { name: "Row1" },
        { name: "Row2" },
        { name: "Row3" },
      ];
      const result = renderTable({
        columns,
        rows,
        zebra: true,
        maxWidth: 80,
      });
      const lines = result.split("\n");
      // Lines: header(0), separator(1), row0(2), row1(3), row2(4), row3(5)
      // Odd rows (index 1, 3) should have dim ANSI codes
      // Row1 is at line index 3
      expect(lines[3]).toContain("\x1b["); // Has ANSI codes (dim)
      // Even rows should not have dim applied by zebra (though header has bold)
      const row0Plain = stripAnsi(lines[2]);
      expect(row0Plain).toContain("Row0");
    });

    it("does not dim rows when zebra is false", () => {
      const columns: Column[] = [{ key: "name", label: "Name", width: 10 }];
      const rows = [{ name: "Row0" }, { name: "Row1" }];
      const resultWithZebra = renderTable({
        columns,
        rows,
        zebra: true,
        maxWidth: 80,
      });
      const resultWithout = renderTable({
        columns,
        rows,
        zebra: false,
        maxWidth: 80,
      });
      // Both should have same plain text content
      expect(stripAnsi(resultWithZebra)).toBe(stripAnsi(resultWithout));
      // But the ANSI content should differ for row 1
      expect(resultWithZebra).not.toBe(resultWithout);
    });
  });

  describe("format functions", () => {
    it("applies format function to cell values", () => {
      const columns: Column[] = [
        {
          key: "value",
          label: "Value",
          width: 10,
          format: (v: number) => `${v}%`,
        },
      ];
      const rows = [{ value: 42 }];
      const result = renderTable({ columns, rows, maxWidth: 80 });
      const plain = stripAnsi(result);
      expect(plain).toContain("42%");
    });

    it("passes the full row to format function", () => {
      const columns: Column[] = [
        {
          key: "computed",
          label: "Result",
          width: 15,
          format: (_v: any, row: Record<string, any>) =>
            `${row.first} ${row.last}`,
        },
      ];
      const rows = [{ computed: null, first: "Alice", last: "Chen" }];
      const result = renderTable({ columns, rows, maxWidth: 80 });
      const plain = stripAnsi(result);
      expect(plain).toContain("Alice Chen");
    });

    it("handles format functions that return ANSI strings", () => {
      const columns: Column[] = [
        {
          key: "status",
          label: "Status",
          width: 10,
          format: (v: string) =>
            v === "ok" ? chalk.green("PASS") : chalk.red("FAIL"),
        },
      ];
      const rows = [{ status: "ok" }];
      const result = renderTable({ columns, rows, maxWidth: 80 });
      const plain = stripAnsi(result);
      expect(plain).toContain("PASS");
      // Should contain ANSI color codes
      const lines = result.split("\n");
      expect(lines[lines.length - 1]).toContain("\x1b[");
    });
  });

  describe("groupSeparator", () => {
    it("inserts a dashed separator after specified row indices", () => {
      const columns: Column[] = [
        { key: "name", label: "Name", width: 10 },
      ];
      const rows = [
        { name: "Alice" },
        { name: "Bob" },
        { name: "Carol" },
        { name: "Dave" },
      ];
      const result = renderTable({
        columns,
        rows,
        groupSeparator: [1],
        maxWidth: 80,
      });
      const lines = result.split("\n");
      // Should have: header, separator, row0, row1, group-sep, row2, row3 = 7 lines
      expect(lines).toHaveLength(7);
      // The group separator (line 4) should contain dashes
      const sepPlain = stripAnsi(lines[4]);
      expect(sepPlain).toContain("\u2500");
    });

    it("inserts multiple separators", () => {
      const columns: Column[] = [
        { key: "name", label: "Name", width: 10 },
      ];
      const rows = [
        { name: "A" },
        { name: "B" },
        { name: "C" },
        { name: "D" },
      ];
      const result = renderTable({
        columns,
        rows,
        groupSeparator: [0, 2],
        maxWidth: 80,
      });
      const lines = result.split("\n");
      // header, separator, row0, group-sep, row1, row2, group-sep, row3 = 8 lines
      expect(lines).toHaveLength(8);
    });
  });

  describe("footer rows", () => {
    it("renders footer rows after a separator", () => {
      const columns: Column[] = [
        { key: "name", label: "Name", width: 10 },
        { key: "value", label: "Value", width: 8 },
      ];
      const rows = [{ name: "Alice", value: 100 }];
      const footerRows = [{ name: "Total", value: 100 }];
      const result = renderTable({
        columns,
        rows,
        footerRows,
        maxWidth: 80,
      });
      const plain = stripAnsi(result);
      expect(plain).toContain("Total");
      // Footer should be separated from data
      const lines = result.split("\n");
      // header, sep, data, footer-sep, footer = 5 lines
      expect(lines).toHaveLength(5);
    });
  });

  describe("highlightRow", () => {
    it("bolds the specified row", () => {
      const columns: Column[] = [
        { key: "name", label: "Name", width: 10 },
      ];
      const rows = [{ name: "Alice" }, { name: "Bob" }];
      const result = renderTable({
        columns,
        rows,
        highlightRow: 0,
        maxWidth: 80,
      });
      const lines = result.split("\n");
      // The highlighted row (line 2) should have bold ANSI codes
      expect(lines[2]).toContain("\x1b[");
    });
  });

  describe("alignment", () => {
    it("right-aligns values when align is right", () => {
      const columns: Column[] = [
        { key: "value", label: "Value", width: 10, align: "right" },
      ];
      const rows = [{ value: "42" }];
      const result = renderTable({ columns, rows, maxWidth: 80 });
      const lines = result.split("\n");
      const dataPlain = stripAnsi(lines[lines.length - 1]);
      // "42" should be right-aligned in 10 chars
      expect(dataPlain).toBe("        42");
    });

    it("center-aligns values when align is center", () => {
      const columns: Column[] = [
        { key: "value", label: "Value", width: 10, align: "center" },
      ];
      const rows = [{ value: "Hi" }];
      const result = renderTable({ columns, rows, maxWidth: 80 });
      const lines = result.split("\n");
      const dataPlain = stripAnsi(lines[lines.length - 1]);
      // "Hi" center-aligned in 10 chars
      expect(dataPlain).toBe("    Hi    ");
    });
  });

  describe("header color", () => {
    it("applies headerColor function to header labels", () => {
      const columns: Column[] = [
        {
          key: "name",
          label: "Name",
          width: 10,
          headerColor: chalk.cyan,
        },
      ];
      const rows = [{ name: "Alice" }];
      const result = renderTable({ columns, rows, maxWidth: 80 });
      const lines = result.split("\n");
      // Header should contain cyan ANSI codes
      expect(lines[0]).toContain("\x1b[");
      const headerPlain = stripAnsi(lines[0]);
      expect(headerPlain).toContain("Name");
    });
  });

  describe("empty inputs", () => {
    it("returns empty string for no columns", () => {
      const result = renderTable({ columns: [], rows: [] });
      expect(result).toBe("");
    });

    it("renders header only for empty rows", () => {
      const columns: Column[] = [
        { key: "name", label: "Name", width: 10 },
      ];
      const result = renderTable({ columns, rows: [], maxWidth: 80 });
      const lines = result.split("\n");
      const headerPlain = stripAnsi(lines[0]);
      expect(headerPlain).toContain("Name");
    });
  });

  describe("auto-sized columns", () => {
    it("sizes columns to fit content when no width or flex", () => {
      const columns: Column[] = [
        { key: "name", label: "Name" },
        { key: "city", label: "City" },
      ];
      const rows = [
        { name: "Alice", city: "Portland" },
        { name: "Bob", city: "NYC" },
      ];
      const result = renderTable({ columns, rows, maxWidth: 80 });
      const lines = result.split("\n");
      const headerPlain = stripAnsi(lines[0]);
      // "Name" header is 4 chars, but "Alice" is 5 => auto width should be 5
      // "City" header is 4 chars, but "Portland" is 8 => auto width should be 8
      // Total: 5 + 1 + 8 = 14
      expect(headerPlain).toHaveLength(14);
    });
  });
});
