/**
 * Pure semantics behind the input-mapping and trigger-config builders —
 * the last two JsonField seams. Kept free of React so the rules are
 * unit-testable; InputMappingField / TriggerConfigField render them.
 *
 * The input-mapping form toggle is LOSSLESS by construction: a Record
 * mapping and a single object-constructor Expression have identical
 * runtime semantics (each field resolves against state, the object
 * JSON-serializes), so switching forms converts between them instead
 * of discarding work — the same non-destructive philosophy as
 * `converted` in expression-model.ts.
 */
import type { Expression, TaskStep, TriggerConfig } from '@helmsmith/flow-spec';

type MappingFields = Readonly<Record<string, Expression>>;

/** The wire heuristic, mirrored: a string `kind` marks the
 *  single-Expression form (which is why mapping keys must never be
 *  named "kind"). */
export function isSingleExpression(input: NonNullable<TaskStep['input']>): input is Expression {
  return typeof (input as { kind?: unknown }).kind === 'string';
}

/** Record form → single form: an object constructor with the same
 *  fields — identical runtime semantics, nothing lost. */
export function singleFromFields(fields: MappingFields): Expression {
  return { kind: 'object', fields };
}

/** Single form → record form: an object constructor unwraps
 *  losslessly; anything else becomes the sole `value` field. */
export function fieldsFromSingle(expr: Expression): MappingFields {
  if (expr.kind === 'object') return expr.fields;
  return { value: expr };
}

/** Fresh field name, skipping taken names and the reserved `kind`
 *  discriminator key. */
export function uniqueMappingName(existing: MappingFields, base = 'f'): string {
  let n = 1;
  let name = base === 'kind' ? 'kind1' : `${base}${n}`;
  const taken = (candidate: string) => candidate === 'kind' || candidate in existing;
  while (taken(name)) {
    n += 1;
    name = `${base === 'kind' ? 'kind' : base}${n}`;
  }
  return name;
}

/** A valid blank per trigger kind (the validator's constraints hold:
 *  non-empty strings, cron in the subset grammar, no tz). */
export function defaultTriggerConfig(kind: TriggerConfig['kind']): TriggerConfig {
  switch (kind) {
    case 'manual':
      return { kind };
    case 'webhook':
      return { kind, path: 'my-hook' };
    case 'schedule':
      return { kind, cron: '0 9 * * 1-5' };
    case 'event':
      return { kind, eventType: 'my-event' };
    case 'message':
      return { kind, channel: 'ops' };
  }
}
