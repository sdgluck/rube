/**
 * One parsed clause. Matches the smart_filter rule type's runtime config
 * shape so the importer can hand the result straight to the rule
 * generator without translation.
 */
export interface ParsedClause {
  field: string;
  op: "=" | "!=" | ">=" | "<=";
  value: string;
}

export interface ParseResult {
  filters: ParsedClause[];
  /**
   * Clauses that couldn't be translated (OR-grouped values, strict
   * gt/lt, advanced group markers). Surface in the provider's
   * `unmappable` list verbatim so the user sees what was skipped instead
   * of a silently-lossy migration.
   */
  unsupported: string[];
}

/**
 * Pure shape-control fields with no semantic content — strip silently.
 * `type=N` (section type), `sort=…`, pagination, and the various
 * `includeFoo` flags fall here.
 */
const SHAPE_FIELDS = new Set(["type", "sort", "limit", "includeGuids", "includeCollections", "includeAdvanced"]);

/**
 * Group-control fields. Plex emits these (with non-empty values) to mark
 * OR groups or nested AND/OR structures: `or=1`, `push=1`, `pop=1`,
 * `and=1`, `group=…`. The smart_filter rule type doesn't model groups,
 * so any non-empty group marker disqualifies the whole filter — silently
 * dropping them turns a real OR query into a contradictory AND chain
 * that matches nothing in Plex.
 */
const GROUP_FIELDS = new Set(["push", "pop", "and", "or", "group"]);

const X_PLEX_PREFIX = "X-Plex-";

/**
 * Operator suffixes Plex emits on its filter URIs. The longer suffixes
 * MUST be tried first (`>>=` before `>>`, both before `=`) — string-wise
 * `key>>=value` ends with `=` too, and naïve `=` matching would split
 * the wrong way and drop the operator entirely.
 */
const OP_SUFFIXES: Array<{ suffix: string; op: ParsedClause["op"] | null }> = [
  { suffix: ">>=", op: ">=" },
  { suffix: "<<=", op: "<=" },
  { suffix: ">>", op: null }, // strict gt — not modelled by smart_filter rule type yet
  { suffix: "<<", op: null }, // strict lt — same
  { suffix: "!=", op: "!=" },
  { suffix: "=", op: "=" },
];

/**
 * Parse a Plex smart-collection content URI into structured clauses.
 *
 * Plex stores the filter as a `/library/sections/N/all?…` path with a
 * mix of conventional `key=value` pairs and Plex-flavored operator
 * suffixes (`>>=`, `<<=`, `!=`). We strip the path and pagination
 * noise, decode each pair, and return the clauses smart_filter
 * understands. Anything we can't model (OR-grouped values via `|`,
 * strict gt/lt, group markers) is surfaced under `unsupported` so the
 * caller can route the collection to `unmappable` rather than create a
 * silently-lossy rule.
 */
export function parseSmartFilterUri(uri: string): ParseResult {
  const filters: ParsedClause[] = [];
  const unsupported: string[] = [];

  const queryStart = uri.indexOf("?");
  if (queryStart < 0) return { filters, unsupported };
  const query = uri.slice(queryStart + 1);

  for (const raw of query.split("&")) {
    if (!raw) continue;

    // Find the operator suffix — the LONGEST match wins. We iterate
    // OP_SUFFIXES in length-descending order so `key>>=v` doesn't match
    // `=` first and lose the `>>` prefix.
    let matched: { field: string; op: ParsedClause["op"] | null; value: string; suffix: string } | null = null;
    for (const { suffix, op } of OP_SUFFIXES) {
      const idx = raw.indexOf(suffix);
      if (idx < 0) continue;
      // First-by-length iteration guarantees we hit the longest valid
      // suffix first; once matched, take it.
      matched = { field: raw.slice(0, idx), op, value: raw.slice(idx + suffix.length), suffix };
      break;
    }

    if (!matched) {
      unsupported.push(raw);
      continue;
    }

    const field = decodeURIComponent(matched.field);
    const value = decodeURIComponent(matched.value);

    if (SHAPE_FIELDS.has(field)) continue;
    if (field.startsWith(X_PLEX_PREFIX)) continue;

    // Group markers must surface as unsupported. Stripping them silently
    // turns a real OR query into an AND chain that matches nothing.
    if (GROUP_FIELDS.has(field)) {
      unsupported.push(`${field}=${value} (group marker)`);
      continue;
    }

    if (matched.op === null) {
      unsupported.push(`${field} (strict ${matched.suffix === ">>" ? "gt" : "lt"})`);
      continue;
    }

    // Pipe-separated values are Plex's "OR within field" syntax. The
    // smart_filter rule type doesn't model OR yet — flag the whole
    // clause as unsupported so the importer marks the collection
    // unmappable rather than dropping every value but the first.
    if (value.includes("|")) {
      unsupported.push(`${field}=${value} (OR group)`);
      continue;
    }

    if (!field || !value) {
      unsupported.push(raw);
      continue;
    }

    filters.push({ field, op: matched.op, value });
  }

  // Repeated `field=value` clauses are Plex's "in" semantics
  // (`genre=Action&genre=Comedy` — match items in EITHER). AND'ing both
  // would produce a contradiction. Range queries that repeat a field
  // with different operators (`year>>=1990&year<<=1999`) are a legitimate
  // AND, so only demote duplicates when at least one is the equality op.
  const eqCounts = new Map<string, number>();
  for (const f of filters) {
    if (f.op === "=") eqCounts.set(f.field, (eqCounts.get(f.field) ?? 0) + 1);
  }
  const remaining: ParsedClause[] = [];
  for (const f of filters) {
    if (f.op === "=" && (eqCounts.get(f.field) ?? 0) > 1) {
      unsupported.push(`${f.field}=${f.value} (repeated field — Plex 'in' semantics)`);
    } else {
      remaining.push(f);
    }
  }

  return { filters: remaining, unsupported };
}
