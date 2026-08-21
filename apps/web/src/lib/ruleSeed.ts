/**
 * A half-written rule, carried across a navigation.
 *
 * Two pages now hand the rule wizard a starting point: Media, which turns the
 * view you are looking at into a smart filter, and Discover, which turns a
 * list you just found into a `list_source`. Both arrive as router state rather
 * than query params — a filter tree is a nested object, and round-tripping it
 * through a URL would mean inventing an encoding for something that only has
 * to survive one navigation.
 *
 * It is a discriminated union rather than one wide optional-everything object
 * so the wizard cannot be handed a seed that names a rule type and then
 * carries the wrong fields for it.
 */

import type { SmartFilterRuleSeed } from "./viewToRule.ts";

/** The providers Discover can search. IMDb has no list-search API. */
export type ListSeedProvider = "mdblist" | "trakt";

export interface ListSourceRuleSeed {
  kind: "list_source";
  listProvider: ListSeedProvider;
  /** The provider's numeric id — a slug follows a rename, an id doesn't. */
  listId: string;
  /**
   * The list's own name, used as the collection name.
   *
   * Carried across rather than left blank so the rule reads as the thing the
   * user picked. Without it the wizard shows an empty name field and the
   * collection ends up named after whatever the list was called at run time,
   * which is a different string on a bad day.
   */
  collectionName: string;
}

export type RuleSeed = SmartFilterRuleSeed | ListSourceRuleSeed;

/** What Discover's "Create rule" button sends. */
export function listSourceSeed(hit: { provider: ListSeedProvider; listId: string; name: string }): ListSourceRuleSeed {
  return {
    kind: "list_source",
    listProvider: hit.provider,
    listId: hit.listId,
    collectionName: hit.name.trim(),
  };
}
