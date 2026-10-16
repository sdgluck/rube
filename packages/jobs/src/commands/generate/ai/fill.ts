/**
 * An AI rule's `aiFill: "recommender"` path: the model has named each theme
 * and a few titles that define it; this grows each set of examples into a
 * collection from the library's nearest titles.
 *
 * Titles one collection was filled with are withheld from the next. Without
 * that, two themes whose examples sit near each other fill alike, and the
 * point of the mode — rosters that differ — is lost to the overlap guard
 * dropping one of them.
 *
 * The examples themselves are policed too, because the prompt asking for
 * distinct ones is not enough. qwen3 gave six of ten themes the same three
 * titles (The French Dispatch, The Killer, The Plague of the Zombies). Each
 * filled to a different roster, since the fill skips used titles, so the
 * overlap guard passed them — and they came out as successive rings around
 * one generic point, "popular and acclaimed, 2015–2024", with the two seeds in
 * six collections. So an example counts once per run, and a theme needs
 * examples that resemble each other.
 *
 * And no series may hold more than `MAX_PER_SERIES` places in a theme — see
 * `series.ts` for the eight Harry Potter films that made that necessary.
 */
import type { RankResult } from "@tinkerbell/domain.recommendations";
import type { Candidate, MatchedItem } from "./select.ts";
import { MAX_PER_SERIES, seriesKey } from "./series.ts";

export type Nearest = (opts: { seeds: string[]; candidates: string[]; limit: number }) => RankResult;
/** Mean pairwise cosine of these titles, or null if under two have a vector. */
export type Cohesion = (keys: string[]) => number | null;

/** Fewer fresh examples than this and there is no theme left to aim at. */
export const MIN_SEEDS = 2;

/**
 * Below this, the examples have nothing in common. Measured on the published
 * model: sets of random titles came out 0.03–0.10; the seeds that produced
 * coherent collections 0.21–0.43; directors and styles (Fincher, Nolan,
 * Lynch, Kubrick, Hammer, Ghibli) 0.31–0.89. Fincher's own films are only
 * 0.21 apart, so a stricter floor starts refusing real auteur themes.
 */
export const MIN_COHESION = 0.15;

export type Dropped =
  /** Fewer than `MIN_SEEDS` examples once those an earlier theme holds are set aside. */
  { reason: "examples"; fresh: number; reused: number } | { reason: "scattered"; cohesion: number };

export interface Filled<T extends MatchedItem> extends Candidate<T> {
  /** The examples the model chose, which lead the collection. */
  seeds: number;
  /** Why nothing was added, when the recommender declined. */
  skipped?: Extract<RankResult, { skipped: unknown }>;
  /** Why the theme was abandoned before filling. */
  dropped?: Dropped;
  /** Titles passed over because their series already had its share. */
  capped?: number;
}

export function fillFromSeeds<T extends MatchedItem>(
  collections: Candidate<T>[],
  library: T[],
  maxItems: number,
  nearest: Nearest,
  cohesion: Cohesion = () => null,
): Filled<T>[] {
  const byKey = new Map(library.map((item) => [item.ratingKey, item]));
  // Every title a kept theme holds, as an example or a fill.
  const used = new Set<string>();
  return collections.map(({ name, matched }) => {
    const keys = new Set<string>();
    const distinct = matched.filter((m) => !keys.has(m.ratingKey) && keys.add(m.ratingKey));
    const seeds = distinct.filter((m) => !used.has(m.ratingKey)).slice(0, maxItems);
    if (seeds.length < MIN_SEEDS) {
      const dropped = { reason: "examples" as const, fresh: seeds.length, reused: distinct.length - seeds.length };
      return { name, matched: [], seeds: 0, dropped };
    }
    const seedKeys = seeds.map((s) => s.ratingKey);
    const alike = cohesion(seedKeys);
    if (alike !== null && alike < MIN_COHESION) {
      return { name, matched: [], seeds: 0, dropped: { reason: "scattered", cohesion: alike } };
    }

    for (const key of seedKeys) used.add(key);
    const room = maxItems - seeds.length;
    if (room <= 0) return { name, matched: seeds, seeds: seeds.length };

    // Over-asked, because the series cap below can pass over a run of them.
    const ranked = nearest({
      seeds: seedKeys,
      candidates: library.map((i) => i.ratingKey).filter((k) => !used.has(k)),
      limit: room * 3,
    });
    if ("skipped" in ranked) return { name, matched: seeds, seeds: seeds.length, skipped: ranked };

    const perSeries = new Map<string, number>();
    const take = (item: T) => {
      const key = seriesKey(item.title);
      const n = perSeries.get(key) ?? 0;
      if (n >= MAX_PER_SERIES) return false;
      perSeries.set(key, n + 1);
      return true;
    };
    for (const seed of seeds) take(seed);
    const added: T[] = [];
    let capped = 0;
    for (const key of ranked.ratingKeys) {
      if (added.length === room) break;
      const item = byKey.get(key);
      if (!item) continue;
      if (take(item)) added.push(item);
      else capped++;
    }
    for (const item of added) used.add(item.ratingKey);
    return { name, matched: [...seeds, ...added], seeds: seeds.length, capped };
  });
}
