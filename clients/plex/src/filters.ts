/**
 * plex.tv share filters are a single string per media type holding several
 * independent clauses — `contentRating=PG|PG-13|label=Kids`. Tinkerbell owns
 * the `label=` clause (personalization writes `label=Tinkerbell|User:<name>`
 * into it) while an admin owns `contentRating=`, so every write has to edit
 * one clause and leave the other exactly as it found it.
 *
 * The grammar is ambiguous by design on Plex's side: `|` separates clauses
 * *and* values within a clause. Splitting on `|` and treating a token
 * containing `=` as the start of a new clause resolves it, and round-trips
 * both the `label=A|B` form this repo has always written and the
 * multi-clause form the Plex web app produces.
 */

export interface ShareFilterClauses {
  /** Clause name → values, in first-seen order. */
  clauses: Map<string, string[]>;
}

export function parseShareFilter(raw: string | undefined | null): ShareFilterClauses {
  const clauses = new Map<string, string[]>();
  let current: string[] | undefined;

  for (const token of (raw ?? "").split("|")) {
    if (!token) continue;
    const eq = token.indexOf("=");
    if (eq === -1) {
      // A bare value continues the clause before it. A leading one with no
      // clause to attach to is malformed; dropping it beats guessing.
      current?.push(token);
      continue;
    }
    const name = token.slice(0, eq);
    const first = token.slice(eq + 1);
    current = clauses.get(name) ?? [];
    if (first) current.push(first);
    clauses.set(name, current);
  }

  return { clauses };
}

export function composeShareFilter({ clauses }: ShareFilterClauses): string {
  const parts: string[] = [];
  for (const [name, values] of clauses) {
    if (values.length === 0) continue;
    parts.push(`${name}=${values.join("|")}`);
  }
  return parts.join("|");
}

export function getFilterClause(raw: string | undefined | null, name: string): string[] {
  return parseShareFilter(raw).clauses.get(name) ?? [];
}

/**
 * Replace one clause, preserving every other clause and their order. An empty
 * `values` removes the clause outright — which is how a filter is cleared,
 * since Plex treats a present-but-empty clause as "match nothing".
 */
export function setFilterClause(raw: string | undefined | null, name: string, values: string[]): string {
  const parsed = parseShareFilter(raw);
  const cleaned = values.map((v) => v.trim()).filter(Boolean);
  if (cleaned.length === 0) parsed.clauses.delete(name);
  else parsed.clauses.set(name, cleaned);
  return composeShareFilter(parsed);
}

/** True when the two strings describe the same clauses, regardless of order. */
export function shareFiltersEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  const norm = (raw: string | undefined | null) => {
    const { clauses } = parseShareFilter(raw);
    return [...clauses.entries()]
      .map(([name, values]) => `${name}=${[...values].sort().join("|")}`)
      .sort()
      .join("&");
  };
  return norm(a) === norm(b);
}
