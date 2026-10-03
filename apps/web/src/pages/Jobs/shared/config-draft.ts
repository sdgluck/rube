/**
 * The settings form's draft, and turning it back into a patch.
 *
 * Pure, so the one subtle rule is testable: a field showing its default is
 * saved as *unset* (`null`), not as the number. An unset field follows the
 * default if a later release changes it; a stored copy of today's default
 * would silently pin the job to it.
 */
import type { FieldSpec } from "@tinkerbell/contracts";

export type Draft = Record<string, unknown>;

const LIST_KINDS = new Set(["sections", "users", "rules"]);

function emptyValue(field: FieldSpec): unknown {
  if (LIST_KINDS.has(field.control.kind)) return [];
  if (field.default !== undefined) return field.default;
  switch (field.control.kind) {
    case "boolean":
      return false;
    case "number":
      return field.control.min;
    case "enum":
      return field.control.options[0]?.value;
    default:
      return undefined;
  }
}

/** What each field shows: the stored value, else the default the job would use. */
export function draftFromConfig(fields: FieldSpec[], stored: Record<string, unknown>): Draft {
  const draft: Draft = {};
  for (const field of fields) draft[field.key] = stored[field.key] ?? emptyValue(field);
  return draft;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The keys that changed, as `jobs.update` takes them. A value equal to what is
 * shown for "unset" becomes `null` (clear) — or is left out entirely when it
 * was already unset. Empty lists are sent as-is; the server stores them as
 * absent ("all").
 */
export function patchFromDraft(fields: FieldSpec[], stored: Record<string, unknown>, draft: Draft): Draft {
  const patch: Draft = {};
  for (const field of fields) {
    const value = draft[field.key];
    const storedValue = stored[field.key];
    const unset = emptyValue(field);
    if (same(value, storedValue ?? unset)) continue;
    if (same(value, unset) && !LIST_KINDS.has(field.control.kind)) {
      patch[field.key] = null;
    } else {
      patch[field.key] = value;
    }
  }
  return patch;
}

/** Whether a field is visible given the rest of the draft. */
export function isVisible(field: FieldSpec, draft: Draft): boolean {
  return !field.showWhen || same(draft[field.showWhen.key], field.showWhen.equals);
}
