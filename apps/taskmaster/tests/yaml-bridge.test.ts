import { describe, expect, it } from 'vitest';
import { safeDump, safeLoad, YamlParseError } from '../src/formats/yaml-bridge.js';

describe('safeLoad', () => {
  it('parses a simple YAML string', () => {
    const result = safeLoad('name: hello\ncount: 42\n');
    expect(result).toEqual({ name: 'hello', count: 42 });
  });

  it('parses YAML arrays', () => {
    const result = safeLoad('- one\n- two\n- three\n');
    expect(result).toEqual(['one', 'two', 'three']);
  });

  it('parses nested objects', () => {
    const yaml = `
parent:
  child:
    value: 10
`;
    const result = safeLoad(yaml) as Record<string, unknown>;
    expect(result).toEqual({ parent: { child: { value: 10 } } });
  });

  it('returns undefined for empty input', () => {
    expect(safeLoad('')).toBeUndefined();
  });

  it('throws YamlParseError with line info on invalid YAML', () => {
    const badYaml = 'key: value\n  bad indent: oops\n';
    expect(() => safeLoad(badYaml)).toThrow(YamlParseError);
    try {
      safeLoad(badYaml);
    } catch (err) {
      const yamlErr = err as YamlParseError;
      expect(yamlErr.name).toBe('YamlParseError');
      expect(yamlErr.line).toBeTypeOf('number');
    }
  });

  it('handles boolean and null values', () => {
    const result = safeLoad('active: true\ndeleted: false\nvalue: null\n');
    expect(result).toEqual({ active: true, deleted: false, value: null });
  });
});

describe('safeDump', () => {
  it('dumps a simple object to YAML', () => {
    const result = safeDump({ name: 'hello', count: 42 });
    expect(result).toContain('name: hello');
    expect(result).toContain('count: 42');
  });

  it('dumps arrays correctly', () => {
    const result = safeDump({ items: ['a', 'b', 'c'] });
    expect(result).toContain('- a');
    expect(result).toContain('- b');
    expect(result).toContain('- c');
  });

  it('round-trips data through load/dump', () => {
    const original = {
      id: 'T-1',
      title: 'Build something',
      complexity: 5,
      tags: ['backend', 'api'],
      nested: { a: 1, b: 'two' },
    };
    const yamlStr = safeDump(original);
    const roundTripped = safeLoad(yamlStr);
    expect(roundTripped).toEqual(original);
  });

  it('handles empty objects and arrays', () => {
    const result = safeDump({ items: [], meta: {} });
    expect(safeLoad(result)).toEqual({ items: [], meta: {} });
  });
});
