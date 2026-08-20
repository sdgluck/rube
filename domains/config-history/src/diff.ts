/**
 * The diff, computed for display.
 *
 * `change_log` stores whole snapshots — see the table comment for why — so
 * something has to turn two of them into "these four fields moved". Doing it
 * here rather than in storage means the presentation can change without a
 * migration, and a row written by an older version still renders.
 *
 * Pure, and deliberately free of any import: the shape of a rule is not this
 * module's business, and a diff that knew about rules would need to know about
 * config values and job schedules too.
 */

export interface FieldChange {
  /** Dotted path: `config.limit`, `schedule`, `config.smartFilter`. */
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural equality via serialisation.
 *
 * Adequate because everything in this table arrived as JSON out of a SQLite
 * text column, so there are no `Date`s, no `undefined` inside objects and no
 * cycles to trip over. Key order is the one hazard — two logically equal
 * objects written by different code paths could serialise differently — so
 * keys are sorted first.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (!isPlainObject(val)) return val;
    return Object.fromEntries(
      Object.keys(val)
        .sort()
        .map((k) => [k, val[k]]),
    );
  });
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Walk two snapshots into a flat list of field changes.
 *
 * Recursion stops at anything that is not a plain object on *both* sides.
 * Arrays are compared whole rather than element-wise: a rule's `sections` list
 * losing an entry is one fact worth reporting, and an index-by-index diff of a
 * reordered smart filter would be pages of noise describing a change nobody
 * made.
 */
export function diffSnapshots(before: unknown, after: unknown, prefix = ""): FieldChange[] {
  if (!isPlainObject(before) || !isPlainObject(after)) {
    if (deepEqual(before, after)) return [];
    return [{ path: prefix || "value", kind: "changed", before, after }];
  }

  const changes: FieldChange[] = [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();

  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const a = before[key];
    const b = after[key];
    if (deepEqual(a, b)) continue;

    if (a === undefined) changes.push({ path, kind: "added", after: b });
    else if (b === undefined) changes.push({ path, kind: "removed", before: a });
    else if (isPlainObject(a) && isPlainObject(b)) changes.push(...diffSnapshots(a, b, path));
    else changes.push({ path, kind: "changed", before: a, after: b });
  }

  return changes;
}
