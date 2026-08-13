/**
 * Cron scheduling for `{ kind: 'schedule' }` triggers (roadmap 3.1).
 *
 * Implements EXACTLY the subset grammar flow-spec's validator accepts
 * (`validateCronExpression`): five fields — minute, hour, day-of-month,
 * month, day-of-week — each `*`, `*\/n`, or a comma list of numbers /
 * a-b ranges. No names, no range-steps. dow 7 ≡ 0 ≡ Sunday. Standard
 * cron day quirk: when BOTH day-of-month and day-of-week are
 * restricted, a day matches if EITHER does.
 *
 * Schedules evaluate in SERVER-LOCAL time (the validator rejects `tz`).
 * Next-fire is found by scanning minute boundaries — bounded to one
 * year, past which the schedule is declared unsatisfiable (e.g. Feb 30).
 */

const FIELD_BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day-of-month
  [1, 12], // month
  [0, 7], // day-of-week
];

/** null = unrestricted (`*`); otherwise the allowed value set. */
type FieldMatcher = Set<number> | null;

function parseField(field: string, lo: number, hi: number, isDow: boolean): FieldMatcher {
  if (field === '*') return null;
  const values = new Set<number>();
  const step = field.match(/^\*\/(\d+)$/);
  if (step) {
    const n = Number(step[1]);
    for (let v = lo; v <= hi; v += n) values.add(v);
  } else {
    for (const part of field.split(',')) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) throw new Error(`cron field "${field}" is not in the supported subset`);
      const a = Number(m[1]);
      const b = m[2] !== undefined ? Number(m[2]) : a;
      for (let v = a; v <= b; v++) values.add(v);
    }
  }
  if (isDow && values.has(7)) {
    values.delete(7);
    values.add(0);
  }
  return values;
}

/**
 * The next server-local minute boundary strictly after `after` at which
 * the expression matches. Throws when no match exists within a year.
 */
export function nextCronFire(cron: string, after: Date): Date {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron "${cron}" must have 5 fields`);
  const [minute, hour, dom, month, dow] = fields.map((f, i) => {
    const bounds = FIELD_BOUNDS[i] ?? [0, 0];
    return parseField(f, bounds[0], bounds[1], i === 4);
  });

  const candidate = new Date(after.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = after.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (candidate.getTime() <= limit) {
    const monthOk = month === null || month.has(candidate.getMonth() + 1);
    // Standard cron: both day fields restricted → OR; otherwise AND
    // with the (single) restricted one.
    const domOk = dom === null || dom.has(candidate.getDate());
    const dowOk = dow === null || dow.has(candidate.getDay());
    const dayOk = dom !== null && dow !== null ? domOk || dowOk : domOk && dowOk;
    if (!monthOk || !dayOk) {
      // Skip to the next day's 00:00 — day-level mismatch.
      candidate.setHours(0, 0, 0, 0);
      candidate.setDate(candidate.getDate() + 1);
      continue;
    }
    if (hour !== null && !hour.has(candidate.getHours())) {
      candidate.setMinutes(0, 0, 0);
      candidate.setHours(candidate.getHours() + 1);
      continue;
    }
    if (minute !== null && !minute.has(candidate.getMinutes())) {
      candidate.setMinutes(candidate.getMinutes() + 1);
      continue;
    }
    return candidate;
  }
  throw new Error(`cron "${cron}" never fires within a year of ${after.toISOString()}`);
}
