/**
 * plex.tv share filters are a single string per media type holding several
 * independent clauses — `contentRating=PG,PG-13|label=Kids`. Tinkerbell owns
 * the `label=` clause (personalization writes `label=Tinkerbell,User:<name>`
 * into it) while an admin owns `contentRating=`, so every write has to edit
 * one clause and leave the other exactly as it found it.
 *
 * `|` separates clauses and `,` separates a clause's values, which Plex ORs.
 * This repo used to write `label=Tinkerbell|User:<name>`, reading `|` as
 * the value separator too. Plex reads that as `label=Tinkerbell` plus a stray
 * token it ignores (verified on a real server, 2026-10-12: rewriting the same
 * labels with a comma made the user's own rows appear at once). So from the start
 * every restricted user saw everything labelled `Tinkerbell` and nothing
 * labelled for them. A bare token is therefore dropped when parsing, as Plex
 * drops it: reading the old form as what Plex enforces is what lets
 * reconcile see the drift and rewrite it.
 */

export interface ShareFilterClauses {
  /** Clause name → values, in first-seen order. */
  clauses: Map<string, string[]>;
}

export function parseShareFilter(raw: string | undefined | null): ShareFilterClauses {
  const clauses = new Map<string, string[]>();
  for (const token of (raw ?? "").split("|")) {
    const eq = token.indexOf("=");
    if (eq === -1) continue;
    const name = token.slice(0, eq);
    const values = token
      .slice(eq + 1)
      .split(",")
      .filter(Boolean);
    clauses.set(name, [...(clauses.get(name) ?? []), ...values]);
  }
  return { clauses };
}

export function composeShareFilter({ clauses }: ShareFilterClauses): string {
  const parts: string[] = [];
  for (const [name, values] of clauses) {
    if (values.length === 0) continue;
    parts.push(`${name}=${values.join(",")}`);
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
      .map(([name, values]) => `${name}=${[...values].sort().join(",")}`)
      .sort()
      .join("&");
  };
  return norm(a) === norm(b);
}
