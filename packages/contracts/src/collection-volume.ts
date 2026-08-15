/**
 * How many collections a grouped rule is likely to build, and when that number
 * stops being something anybody wanted.
 *
 * A grouped rule slices a library into one collection per director/studio/
 * decade. With no floor on group size, "Studios" over a 4,000-film library is
 * not the forty studios the user pictured — it is every production company
 * that ever took a credit, five thousand of them, most with a single film.
 * That run wrote 85 collections before Plex answered a create with a 500 and
 * the rule died. The volume is the bug; this module is what lets the wizard
 * say so before the rule is saved.
 *
 * Lives in contracts because both sides need it: the wizard warns with it, and
 * the same per-type floors are what a rule is seeded with.
 */

import { producesManyCollections, type RuleTypeValue } from "./rule-config.ts";

/**
 * What a rule type's group universe looks like.
 *
 * `ceiling` is a hard bound on distinct groups that exists in the world, not
 * in the library — there are only so many decades, resolutions, and TMDb
 * genres, and no library size changes that. `perItem` is the fan-out for types
 * with no such bound: how many distinct groups each library item tends to add,
 * which for cast and production companies is well above one because a single
 * film contributes ten actors and three companies.
 *
 * The numbers are calibrated against real libraries rather than derived, and
 * only ever drive a hedged estimate — being out by 30% doesn't change whether
 * "about 5,000 collections" is the right thing to warn about.
 */
interface GroupVolume {
  /** Fan-out per library item, for types whose group count scales with the library. */
  perItem?: number;
  /** Upper bound on distinct groups, for types with a fixed universe. */
  ceiling?: number;
  /** Group size floor the wizard seeds. 1 means "no floor needed for this type". */
  defaultMinItems: number;
}

const GROUP_VOLUMES: Record<string, GroupVolume> = {
  // Open-ended: every film adds new names, so the group count tracks the
  // library and the long tail is almost entirely one-item groups.
  // `actors` takes the top ten billed per item, which is where its fan-out
  // comes from; `studios` counts every production company on the credits.
  // The highest floor of any type, because it fans out the hardest — ten
  // billed names per film means a floor of five still leaves hundreds of
  // actors nobody thinks of as "in" their library.
  actors: { perItem: 2.4, defaultMinItems: 8 },
  directors: { perItem: 0.35, defaultMinItems: 3 },
  studios: { perItem: 1.3, defaultMinItems: 5 },
  networks: { perItem: 0.25, defaultMinItems: 3 },
  countries: { ceiling: 120, defaultMinItems: 3 },
  years: { ceiling: 130, defaultMinItems: 5 },
  awards: { ceiling: 60, defaultMinItems: 3 },
  // Bounded universes, small enough that every group is worth a collection.
  genres: { ceiling: 30, defaultMinItems: 1 },
  content_ratings: { ceiling: 15, defaultMinItems: 1 },
  streaming: { ceiling: 12, defaultMinItems: 1 },
  decades: { ceiling: 15, defaultMinItems: 1 },
  resolutions: { ceiling: 6, defaultMinItems: 1 },
  video_formats: { ceiling: 5, defaultMinItems: 1 },
  based_on: { ceiling: 12, defaultMinItems: 1 },
  seasonal: { ceiling: 12, defaultMinItems: 1 },
  // Long tail of languages nobody has more than one title in.
  audio_languages: { ceiling: 90, defaultMinItems: 3 },
  subtitle_languages: { ceiling: 90, defaultMinItems: 3 },
  // TMDb-sourced: the fetch budget already caps the group count, so the floor
  // only decides which of those groups the library can actually fill.
  tmdb_popular_actors: { defaultMinItems: 3 },
  tmdb_popular_directors: { defaultMinItems: 3 },
  tmdb_franchises: { defaultMinItems: 2 },
  // Not grouped, but it carries a minItems of its own.
  ai_prompt: { defaultMinItems: 15 },
};

/**
 * Group size floor to seed a new rule with. Types whose groups are few and
 * all worth having get 1 — a floor there would only hide the "Documentary"
 * collection somebody actually wanted.
 */
export function defaultMinItemsForRuleType(type: string): number {
  return GROUP_VOLUMES[type]?.defaultMinItems ?? 3;
}

/** Whether a type wants its floor switched on out of the box. */
export function minItemsOnByDefault(type: string): boolean {
  return defaultMinItemsForRuleType(type) > 1;
}

/**
 * How sharply a group-size floor cuts the count.
 *
 * Group sizes are heavily skewed — most studios have one film, a handful have
 * two hundred — so raising the floor by one removes far more groups than it
 * keeps. A power law with this exponent reproduces the shape closely enough
 * for a warning: on the 4,165-film library that prompted this, studios go from
 * ~5,400 groups at no floor to a few hundred at a floor of 5, which is what
 * that library actually holds.
 */
const FLOOR_DECAY_EXPONENT = 1.8;

export interface VolumeEstimateInput {
  type: string;
  /** Total items across every section the rule is scoped to. */
  libraryItems: number;
  /** The rule's group size floor; 0 or 1 both mean "no floor". */
  minItems: number;
  /** The rule's collection cap; 0 means "no cap". */
  limit: number;
}

/**
 * Roughly how many collections this rule will build. Returns null when the
 * type isn't grouped (those build one collection, or a count the user typed)
 * or when we have no library size to reason from.
 *
 * Deliberately an estimate and presented as one — the exact number depends on
 * TMDb metadata we would have to walk the whole library to see, which is what
 * the rule itself does. The purpose is to separate "a few dozen" from
 * "thousands", and for that a coefficient is enough.
 */
export function estimateCollectionCount(input: VolumeEstimateInput): number | null {
  const volume = GROUP_VOLUMES[input.type];
  if (!volume || !producesManyCollections(input.type as RuleTypeValue)) return null;

  // A TMDb-sourced rule's `limit` is a fetch budget, so it bounds the groups
  // outright — the library only decides how many of them come back non-empty.
  const { perItem, ceiling } = volume;
  if (perItem === undefined && ceiling === undefined) {
    return input.limit > 0 ? input.limit : null;
  }
  if (input.libraryItems <= 0) return null;

  // Deliberately not clamped to the library size: an item belongs to several
  // groups at once, so a 4,165-film library really does hold 5,391 production
  // companies. Clamping here is what would make the estimate reassuring at
  // exactly the point it shouldn't be.
  let groups = perItem !== undefined ? perItem * input.libraryItems : Number.POSITIVE_INFINITY;
  if (ceiling !== undefined) groups = Math.min(groups, ceiling);

  const floor = Math.max(1, input.minItems);
  if (floor > 1) groups = groups / Math.pow(floor, FLOOR_DECAY_EXPONENT);

  const capped = input.limit > 0 ? Math.min(groups, input.limit) : groups;
  return Math.max(1, Math.round(capped));
}

/**
 * Where an estimate sits on the "did you mean this?" scale.
 *
 * `warn` sits above what every type's own default floor produces — a warning
 * that fires on the setting we chose for the user teaches them to ignore it.
 * It is set where a library stops looking curated instead: past a few hundred
 * collections the Plex UI is a wall of rows nobody scrolls. `severe` is set
 * where the run itself is at risk — thousands of collections is tens of
 * thousands of Plex writes, which is the load that produced the 500.
 */
export const VOLUME_WARN_THRESHOLD = 400;
export const VOLUME_SEVERE_THRESHOLD = 1500;

export type VolumeLevel = "ok" | "warn" | "severe";

export function volumeLevel(estimate: number | null): VolumeLevel {
  if (estimate === null) return "ok";
  if (estimate >= VOLUME_SEVERE_THRESHOLD) return "severe";
  if (estimate >= VOLUME_WARN_THRESHOLD) return "warn";
  return "ok";
}

/**
 * Round to something that reads as the approximation it is. "About 5,000"
 * invites the right reaction; "5,391" invites the user to believe it.
 */
export function approximateCount(estimate: number): string {
  if (estimate >= 1000) return `${Math.round(estimate / 500) * 500}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (estimate >= 100) return `${Math.round(estimate / 50) * 50}`;
  if (estimate >= 20) return `${Math.round(estimate / 10) * 10}`;
  return `${estimate}`;
}
