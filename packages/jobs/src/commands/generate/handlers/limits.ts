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

/** How the two knobs read in a run log — "none" when the user left them off. */
export function describeLimits(config: RuleConfig): string {
  const limit = collectionLimit(config);
  const min = minItemsPerGroup(config);
  return `limit ${limit === Number.POSITIVE_INFINITY ? "none" : limit}, min-items ${min > 1 ? min : "none"}`;
}
