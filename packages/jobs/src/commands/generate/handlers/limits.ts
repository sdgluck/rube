import type { RuleConfig } from "#commands/generate/config.ts";

/**
 * Shared reading of the two knobs every "one collection per group" rule
 * exposes. Both are opt-in: an unset `limit` builds a collection for every
 * group the section produces, and an unset `minItems` keeps groups of any
 * size. The wizard writes the keys only when the user enables them, so
 * "absent" and "off" are the same state here.
 *
 * Rules that fetch their groups from an external API (popular people,
 * franchises) still pass their own fetch cap — that's a request budget,
 * not a collection cap, and is read separately.
 */
export function collectionLimit(config: RuleConfig): number {
  const limit = config.limit;
  return typeof limit === "number" && limit > 0 ? limit : Number.POSITIVE_INFINITY;
}

/** Minimum items a group needs before it's worth a collection. 1 = keep all. */
export function minItemsPerGroup(config: RuleConfig): number {
  const min = config.minItems;
  return typeof min === "number" && min > 1 ? min : 1;
}

/**
 * Apply the rule's include/exclude lists to a set of groups.
 *
 * Comparison is case- and whitespace-insensitive because these lists are typed
 * by a person (or carried over from a Kometa config), and "netflix" failing to
 * match "Netflix" would be a bug report rather than a lesson.
 *
 * Exclusion is applied last, so a value on both lists is excluded — reading
 * "all of these except that" as the intent, rather than treating the overlap
 * as a contradiction the user has to go and resolve.
 */
export function filterGroups<T>(groups: T[], config: RuleConfig, labelOf: (group: T) => string): T[] {
  const include = normaliseList(config.includeValues);
  const exclude = normaliseList(config.excludeValues);
  if (!include && !exclude) return groups;

  return groups.filter((group) => {
    const label = labelOf(group).trim().toLowerCase();
    if (include && !include.has(label)) return false;
    if (exclude?.has(label)) return false;
    return true;
  });
}

function normaliseList(values: string[] | undefined): Set<string> | null {
  if (!values || values.length === 0) return null;
  const out = new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean));
  return out.size > 0 ? out : null;
}

/** How the knobs read in a run log — "none" when the user left them off. */
export function describeLimits(config: RuleConfig): string {
  const limit = collectionLimit(config);
  const min = minItemsPerGroup(config);
  const parts = [`limit ${limit === Number.POSITIVE_INFINITY ? "none" : limit}`, `min-items ${min > 1 ? min : "none"}`];
  // Worth logging: an include/exclude list is the most likely explanation for
  // "why didn't this rule build the collection I expected?".
  if (config.includeValues?.length) parts.push(`only ${config.includeValues.length} named group(s)`);
  if (config.excludeValues?.length) parts.push(`excluding ${config.excludeValues.length}`);
  return parts.join(", ");
}
