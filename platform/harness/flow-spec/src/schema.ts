/**
 * JSON-Schema SUBSET validation for output contracts (roadmap 2.7).
 *
 * The zero-dependency, browser-safe constraint rules out ajv-class
 * validators, so the spec defines an explicit subset and owns its
 * enforcement — the same single-implementation argument as the
 * expression evaluator: a designer previewing an output contract and
 * the runtime enforcing it must agree, and both call this code.
 *
 * Supported keywords: `type` (string or array of strings; the seven
 * JSON types incl. 'integer'), `properties`, `required`,
 * `additionalProperties` (boolean only), `items`, `enum`, `const`,
 * `minimum`/`maximum`, `minLength`/`maxLength`, `minItems`/`maxItems`,
 * `pattern`.
 *
 * Honesty in both directions: `validateSchemaShape` runs at catalog
 * load and REJECTS schemas using anything outside the subset — a
 * keyword the runtime would ignore never validates in the first place
 * (no silently-unenforced `oneOf`). `schemaViolations` runs at runtime
 * (and in previews) and never throws on data — it returns located
 * violation strings, empty when the value conforms.
 *
 * Semantic fixtures live in `fixtures.ts` (SCHEMA_CASES); harness-core's
 * conformance suite replays them against its re-export.
 */
import { CatalogError } from './types.ts';

const SUPPORTED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
]);

const JSON_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

/**
 * Load-time gate: assert `value` is a schema the runtime fully
 * enforces. Throws `CatalogError` with a path-prefixed message on any
 * construct outside the subset. The empty schema `{}` is valid (matches
 * anything).
 */
export function validateSchemaShape(value: unknown, where: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogError(`${where} must be a schema object`);
  }
  const schema = value as Record<string, unknown>;
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new CatalogError(
        `${where} uses unsupported keyword "${key}" — the enforced subset is: ${[...SUPPORTED_KEYWORDS].join(', ')}`,
      );
    }
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const t of types) {
      if (typeof t !== 'string' || !JSON_TYPES.has(t)) {
        throw new CatalogError(
          `${where}.type must be one of ${[...JSON_TYPES].join(', ')} (or an array of them) — got ${JSON.stringify(t)}`,
        );
      }
    }
  }
  if (schema.properties !== undefined) {
    if (
      !schema.properties ||
      typeof schema.properties !== 'object' ||
      Array.isArray(schema.properties)
    ) {
      throw new CatalogError(`${where}.properties must be an object of name → schema`);
    }
    for (const [k, sub] of Object.entries(schema.properties as Record<string, unknown>)) {
      validateSchemaShape(sub, `${where}.properties.${k}`);
    }
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((r) => typeof r !== 'string')) {
      throw new CatalogError(`${where}.required must be an array of property names`);
    }
  }
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== 'boolean'
  ) {
    throw new CatalogError(
      `${where}.additionalProperties must be a boolean in the enforced subset (schema-valued additionalProperties is not supported)`,
    );
  }
  if (schema.items !== undefined) {
    validateSchemaShape(schema.items, `${where}.items`);
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    throw new CatalogError(`${where}.enum must be an array`);
  }
  for (const bound of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[bound] !== undefined && typeof schema[bound] !== 'number') {
      throw new CatalogError(`${where}.${bound} must be a number`);
    }
  }
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') {
      throw new CatalogError(`${where}.pattern must be a string`);
    }
    try {
      new RegExp(schema.pattern);
    } catch (err) {
      throw new CatalogError(
        `${where}.pattern is not a valid regular expression: ${(err as Error).message}`,
      );
    }
  }
}

/**
 * Runtime check: every violation of `schema` by `value`, as located
 * strings (`$.score: expected number, got string`). Empty array =
 * conforming. Never throws on data — callers turn a non-empty result
 * into an error exit / parse failure. Assumes the schema already
 * passed `validateSchemaShape` (the validator guarantees this for
 * catalog-declared schemas).
 */
export function schemaViolations(value: unknown, schema: unknown, path = '$'): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as Record<string, unknown>;
  const issues: string[] = [];

  if (s.type !== undefined) {
    const types = (Array.isArray(s.type) ? s.type : [s.type]) as string[];
    if (!types.some((t) => matchesType(value, t))) {
      issues.push(`${path}: expected ${types.join(' | ')}, got ${describe(value)}`);
      return issues; // wrong type — deeper keyword checks would be noise
    }
  }
  if (s.enum !== undefined && !(s.enum as unknown[]).some((e) => deepEqual(value, e))) {
    issues.push(`${path}: value is not one of the enum alternatives`);
  }
  if (s.const !== undefined && !deepEqual(value, s.const)) {
    issues.push(`${path}: value does not equal the declared const`);
  }
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) {
      issues.push(`${path}: ${value} is below minimum ${s.minimum}`);
    }
    if (typeof s.maximum === 'number' && value > s.maximum) {
      issues.push(`${path}: ${value} is above maximum ${s.maximum}`);
    }
  }
  if (typeof value === 'string') {
    if (typeof s.minLength === 'number' && value.length < s.minLength) {
      issues.push(`${path}: length ${value.length} is below minLength ${s.minLength}`);
    }
    if (typeof s.maxLength === 'number' && value.length > s.maxLength) {
      issues.push(`${path}: length ${value.length} is above maxLength ${s.maxLength}`);
    }
    if (typeof s.pattern === 'string') {
      try {
        if (!new RegExp(s.pattern).test(value)) {
          issues.push(`${path}: does not match pattern ${s.pattern}`);
        }
      } catch {
        // Invalid pattern from unvalidated input — never throw on data.
      }
    }
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) {
      issues.push(`${path}: ${value.length} item(s) is below minItems ${s.minItems}`);
    }
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) {
      issues.push(`${path}: ${value.length} item(s) is above maxItems ${s.maxItems}`);
    }
    if (s.items !== undefined) {
      for (const [i, item] of value.entries()) {
        issues.push(...schemaViolations(item, s.items, `${path}[${i}]`));
      }
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, unknown>;
    if (Array.isArray(s.required)) {
      for (const req of s.required as string[]) {
        if (!(req in obj)) issues.push(`${path}.${req}: required property is missing`);
      }
    }
    for (const [k, sub] of Object.entries(props)) {
      if (k in obj) issues.push(...schemaViolations(obj[k], sub, `${path}.${k}`));
    }
    if (s.additionalProperties === false) {
      for (const k of Object.keys(obj)) {
        if (!(k in props)) issues.push(`${path}.${k}: property is not declared in the schema`);
      }
    }
  }
  return issues;
}

function matchesType(value: unknown, t: string): boolean {
  switch (t) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return (
      ka.length === kb.length &&
      ka.every((k) =>
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return false;
}
