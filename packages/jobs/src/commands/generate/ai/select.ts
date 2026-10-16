/**
 * What survives of an AI response once it is matched against the library.
 *
 * Small local models (qwen3 under Ollama, constrained to the JSON schema and
 * with thinking off) collapse into copying: every collection after the first
 * is the previous one's roster again, under a rhyming name. One real run came
 * back as ten collections of the same six films, each listed twice to reach
 * the ten-item minimum, and all ten were created because nothing here looked
 * past the count. So a collection is measured by its distinct titles, and one
 * that mostly repeats a collection already kept this run is dropped.
 */

export interface MatchedItem {
  ratingKey: string;
  title: string;
  year?: number;
}

export interface Candidate<T extends MatchedItem = MatchedItem> {
  name: string;
  matched: T[];
}

export type Verdict<T extends MatchedItem> =
  | { kind: "keep"; name: string; matched: T[] }
  | { kind: "too-few"; name: string; distinct: number }
  | { kind: "duplicate"; name: string; of: string; shared: number };

/**
 * Share of the smaller roster that may also be in a kept collection. Against
 * the smaller one so a 10-item list wholly inside a 30-item one still counts
 * as a repeat; a half allows the overlap the prompt invites ("each item can
 * appear in multiple collections") without letting a copy through.
 */
export const MAX_OVERLAP = 0.5;

export function selectCollections<T extends MatchedItem>(candidates: Candidate<T>[], minItems: number): Verdict<T>[] {
  const kept: { name: string; keys: Set<string> }[] = [];
  return candidates.map(({ name, matched }) => {
    const seen = new Set<string>();
    const distinct = matched.filter((m) => !seen.has(m.ratingKey) && seen.add(m.ratingKey));
    if (distinct.length < minItems) return { kind: "too-few", name, distinct: distinct.length };

    for (const prior of kept) {
      const shared = distinct.filter((m) => prior.keys.has(m.ratingKey)).length;
      if (shared > MAX_OVERLAP * Math.min(distinct.length, prior.keys.size)) {
        return { kind: "duplicate", name, of: prior.name, shared };
      }
    }
    kept.push({ name, keys: seen });
    return { kind: "keep", name, matched: distinct };
  });
}
