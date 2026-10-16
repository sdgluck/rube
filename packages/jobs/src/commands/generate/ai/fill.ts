/**
 * An AI rule's `aiFill: "recommender"` path: the model has named each theme
 * and a few titles that define it; this grows each set of examples into a
 * collection from the library's nearest titles.
 *
 * Titles one collection was filled with are withheld from the next. Without
 * that, two themes whose examples sit near each other fill alike, and the
 * point of the mode — rosters that differ — is lost to the overlap guard
 * dropping one of them.
 */
import type { RankResult } from "@tinkerbell/domain.recommendations";
import type { Candidate, MatchedItem } from "./select.ts";

export type Nearest = (opts: { seeds: string[]; candidates: string[]; limit: number }) => RankResult;

export interface Filled<T extends MatchedItem> extends Candidate<T> {
  /** The examples the model chose, which lead the collection. */
  seeds: number;
  /** Why nothing was added, when the recommender declined. */
  skipped?: Extract<RankResult, { skipped: unknown }>;
}

export function fillFromSeeds<T extends MatchedItem>(
  collections: Candidate<T>[],
  library: T[],
  maxItems: number,
  nearest: Nearest,
): Filled<T>[] {
  const byKey = new Map(library.map((item) => [item.ratingKey, item]));
  const used = new Set<string>();
  return collections.map(({ name, matched }) => {
    const keys = new Set<string>();
    const seeds = matched.filter((m) => !keys.has(m.ratingKey) && keys.add(m.ratingKey)).slice(0, maxItems);
    const room = maxItems - seeds.length;
    if (room <= 0 || seeds.length === 0) return { name, matched: seeds, seeds: seeds.length };

    const ranked = nearest({
      seeds: seeds.map((s) => s.ratingKey),
      candidates: library.map((i) => i.ratingKey).filter((k) => !used.has(k) && !keys.has(k)),
      limit: room,
    });
    if ("skipped" in ranked) return { name, matched: seeds, seeds: seeds.length, skipped: ranked };

    const added = ranked.ratingKeys.flatMap((k) => byKey.get(k) ?? []);
    for (const item of added) used.add(item.ratingKey);
    return { name, matched: [...seeds, ...added], seeds: seeds.length };
  });
}
