import { fieldKind, type SmartFilterFieldKind } from "./smart-filter-fields.ts";
import type { SmartFilterOp } from "@rube/plex-smart-filter";

/**
 * Operator labels, in English, per field kind.
 *
 * The same Plex operator means different things depending on what it's
 * comparing — `>=` on a year is "is at least", on a date it's "is on or
 * after", on a runtime it's "is at least" but `>` is "is longer than". The
 * symbols (`≥`, `≠`) that used to render here were accurate and unreadable.
 */
export interface OpOption {
  op: SmartFilterOp;
  label: string;
}

const TAG_OPS: OpOption[] = [
  { op: "=", label: "is" },
  { op: "!=", label: "is not" },
  // Plex's `=` on a tag is a loose match; `==` pins it to the exact tag. Rare,
  // but imported filters use it and without it the raw `==` showed through.
  { op: "==", label: "is exactly" },
];

const STRING_OPS: OpOption[] = [
  { op: "=", label: "contains" },
  { op: "==", label: "is" },
  { op: "!=", label: "is not" },
];

const BOOLEAN_OPS: OpOption[] = [{ op: "=", label: "is" }];

const NUMBER_OPS: OpOption[] = [
  { op: "=", label: "is" },
  { op: "!=", label: "is not" },
  { op: ">=", label: "is at least" },
  { op: "<=", label: "is at most" },
  { op: ">", label: "is more than" },
  { op: "<", label: "is less than" },
];

const DATE_OPS: OpOption[] = [
  { op: "=", label: "is" },
  { op: "!=", label: "is not" },
  { op: ">=", label: "is on or after" },
  { op: "<=", label: "is on or before" },
  { op: ">", label: "is after" },
  { op: "<", label: "is before" },
];

const DURATION_OPS: OpOption[] = [
  { op: "=", label: "is" },
  { op: "!=", label: "is not" },
  { op: ">=", label: "is at least" },
  { op: "<=", label: "is at most" },
  { op: ">", label: "is longer than" },
  { op: "<", label: "is shorter than" },
];

const OPS_BY_KIND: Record<SmartFilterFieldKind, OpOption[]> = {
  tag: TAG_OPS,
  string: STRING_OPS,
  boolean: BOOLEAN_OPS,
  number: NUMBER_OPS,
  rating: NUMBER_OPS,
  date: DATE_OPS,
  duration: DURATION_OPS,
};

export function opsFor(field: string): OpOption[] {
  return OPS_BY_KIND[fieldKind(field)];
}

export function opLabel(field: string, op: SmartFilterOp): string {
  return opsFor(field).find((o) => o.op === op)?.label ?? op;
}

/**
 * An imported filter can carry an operator our curated list doesn't offer for
 * that field. Append it verbatim so the select still shows the current value
 * and the filter round-trips unchanged rather than being silently rewritten.
 */
export function withFallbackOp(ops: OpOption[], current: SmartFilterOp): OpOption[] {
  if (ops.some((o) => o.op === current)) return ops;
  return [...ops, { op: current, label: current }];
}
