import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printTitle, printNoData, printSummary, printJson, printTable } from '../ui/cli-renderer.js';

describe('cli-renderer', () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('printTitle', () => {
    it('wraps title with blank lines', () => {
      printTitle('My Title');
      expect(logs).toEqual(['\nMy Title\n']);
    });
  });

  describe('printNoData', () => {
    it('prints default message', () => {
      printNoData();
      expect(logs[0]).toBe('No records found. Run "gitradar scan" first.');
    });

    it('prints custom message', () => {
      printNoData('Nothing here');
      expect(logs[0]).toBe('Nothing here');
    });
  });

  describe('printSummary', () => {
    it('prints summary with leading newline', () => {
      printSummary('5 members');
      expect(logs[0]).toBe('\n5 members');
    });
  });

  describe('printJson', () => {
    it('prints formatted JSON', () => {
      printJson({ a: 1, b: [2, 3] });
      const parsed = JSON.parse(logs[0]);
      expect(parsed).toEqual({ a: 1, b: [2, 3] });
    });

    it('uses 2-space indentation', () => {
      printJson({ x: 1 });
      expect(logs[0]).toContain('  "x"');
    });
  });

  describe('printTable', () => {
    it('renders title, table, and summary', () => {
      printTable({
        title: 'Test Table',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'count', label: 'Count', align: 'right' },
        ],
        rows: [
          { name: 'Alice', count: 42 },
          { name: 'Bob', count: 7 },
        ],
        summary: '2 items',
      });

      // Title is first log
      expect(logs[0]).toBe('\nTest Table\n');
      // Table content has both data rows
      const tableOutput = logs[1];
      expect(tableOutput).toContain('Alice');
      expect(tableOutput).toContain('Bob');
      expect(tableOutput).toContain('42');
      // Summary is last log
      expect(logs[2]).toBe('\n2 items');
    });

    it('omits summary when not provided', () => {
      printTable({
        title: 'No Summary',
        columns: [{ key: 'x', label: 'X' }],
        rows: [{ x: 1 }],
      });

      expect(logs).toHaveLength(2); // title + table, no summary
    });

    it('renders column headers', () => {
      printTable({
        title: 'Header Test',
        columns: [
          { key: 'a', label: 'Alpha' },
          { key: 'b', label: 'Beta' },
        ],
        rows: [{ a: 'x', b: 'y' }],
      });

      const tableOutput = logs[1];
      expect(tableOutput).toContain('Alpha');
      expect(tableOutput).toContain('Beta');
    });
  });
});
