import { sql } from "drizzle-orm";
import { type Db } from "@tinkerbell/db";
import { token } from "@tinkerbell/container";

export type SearchKind =
  | "collection"
  | "media"
  | "rule"
  | "job"
  | "overlayPreset"
  | "event"
  | "plexUser"
  | "plexSection"
  | "preroll";

/** Every kind this module can return, for the router's input schema. */
export const SEARCH_KINDS = [
  "collection",
  "media",
  "rule",
  "job",
  "overlayPreset",
  "event",
  "plexUser",
  "plexSection",
  "preroll",
] as const satisfies readonly SearchKind[];

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

// Convert free-text input into a safe FTS5 MATCH expression: tokenize on
// non-word chars, drop empties, append `*` for prefix matching, AND-join.
// Returns null when there's nothing to search.
function buildMatch(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `${t}*`).join(" ");
}

interface FtsRow {
  id: string | number;
  title: string;
  subtitle: string | null;
}

export interface SearchDeps {
  db: Db;
}
export function createSearch(deps: SearchDeps) {
  const { db } = deps;

  /**
   * Free-text search across everything Tinkerbell knows about.
   *
   * `kinds` narrows the sweep — the palette passes it when the query carries a
   * scope prefix (`rule: nolan`). Narrowing here rather than filtering the
   * results means the per-kind limit applies to the kind you asked for: `rule:`
   * with a limit of 8 returns eight rules, not eight of everything and then
   * however many of those happened to be rules.
   */
  function searchAll(query: string, perKindLimit = 8, kinds?: readonly SearchKind[]): SearchHit[] {
    const match = buildMatch(query);
    if (!match) return [];

    const wanted = kinds && kinds.length > 0 ? new Set<SearchKind>(kinds) : null;
    const want = (kind: SearchKind) => !wanted || wanted.has(kind);

    const hits: SearchHit[] = [];
    const add = (kind: SearchKind, rows: () => SearchHit[]) => {
      if (want(kind)) hits.push(...rows());
    };

    add("collection", () =>
      db
        .all<FtsRow>(sql`
        SELECT collections.plex_rating_key AS id, collections.title AS title, collections.section_title AS subtitle
        FROM collections_fts
        JOIN collections ON collections.plex_rating_key = collections_fts.plex_rating_key
        WHERE collections_fts MATCH ${match}
        ORDER BY bm25(collections_fts) LIMIT ${perKindLimit}
      `)
        .map((r) => ({
          kind: "collection" as const,
          id: String(r.id),
          title: r.title,
          subtitle: r.subtitle ?? undefined,
          href: `/collections?q=${encodeURIComponent(r.title)}`,
        })),
    );

    add("media", () =>
      db
        .all<FtsRow & { year: number | null }>(sql`
        SELECT media_items.rating_key AS id, media_items.title AS title,
               media_items.section_title AS subtitle, media_items.year AS year
        FROM media_items_fts
        JOIN media_items ON media_items.rating_key = media_items_fts.rating_key
        WHERE media_items_fts MATCH ${match}
        ORDER BY bm25(media_items_fts) LIMIT ${perKindLimit}
      `)
        .map((r) => {
          const sub = [r.subtitle, r.year ? String(r.year) : null].filter(Boolean).join(" · ");
          return {
            kind: "media" as const,
            id: String(r.id),
            title: r.title,
            subtitle: sub || undefined,
            href: `/media?q=${encodeURIComponent(r.title)}`,
          };
        }),
    );

    add("rule", () =>
      db
        .all<FtsRow>(sql`
        SELECT rules.id AS id, rules.name AS title, rules.type AS subtitle
        FROM rules_fts
        JOIN rules ON rules.id = rules_fts.id
        WHERE rules_fts MATCH ${match}
        ORDER BY bm25(rules_fts) LIMIT ${perKindLimit}
      `)
        .map((r) => ({
          kind: "rule" as const,
          id: String(r.id),
          title: r.title,
          subtitle: r.subtitle ?? undefined,
          href: `/rules?focus=${encodeURIComponent(String(r.id))}`,
        })),
    );

    add("job", () =>
      db
        .all<FtsRow>(sql`
        SELECT jobs.id AS id, jobs.name AS title, jobs.command AS subtitle
        FROM jobs_fts
        JOIN jobs ON jobs.id = jobs_fts.id
        WHERE jobs_fts MATCH ${match}
        ORDER BY bm25(jobs_fts) LIMIT ${perKindLimit}
      `)
        .map((r) => ({
          kind: "job" as const,
          id: String(r.id),
          title: r.title,
          subtitle: r.subtitle ?? undefined,
          href: `/jobs/${encodeURIComponent(String(r.id))}`,
        })),
    );

    add("overlayPreset", () =>
      db
        .all<FtsRow>(sql`
        SELECT overlay_presets.id AS id, overlay_presets.name AS title,
               overlay_presets.description AS subtitle
        FROM overlay_presets_fts
        JOIN overlay_presets ON overlay_presets.id = overlay_presets_fts.id
        WHERE overlay_presets_fts MATCH ${match}
        ORDER BY bm25(overlay_presets_fts) LIMIT ${perKindLimit}
      `)
        .map((r) => ({
          kind: "overlayPreset" as const,
          id: String(r.id),
          title: r.title,
          subtitle: r.subtitle ?? undefined,
          href: `/overlays?presetId=${encodeURIComponent(String(r.id))}`,
        })),
    );

    add("event", () =>
      db
        .all<FtsRow>(sql`
        SELECT events.id AS id, events.message AS title, events.type AS subtitle
        FROM events_fts
        JOIN events ON events.id = events_fts.event_id
        WHERE events_fts MATCH ${match}
        ORDER BY bm25(events_fts) LIMIT ${perKindLimit}
      `)
        .map((r) => ({
          kind: "event" as const,
          id: String(r.id),
          title: r.title,
          subtitle: r.subtitle ?? undefined,
          href: `/events?q=${encodeURIComponent(r.title)}`,
        })),
    );

    add("plexUser", () =>
      db
        .all<FtsRow>(sql`
        SELECT plex_users.user_id AS id,
               COALESCE(NULLIF(plex_users.name, ''), plex_users.username) AS title,
               plex_users.username AS subtitle
        FROM plex_users_fts
        JOIN plex_users ON plex_users.user_id = plex_users_fts.user_id
        WHERE plex_users_fts MATCH ${match}
        ORDER BY bm25(plex_users_fts) LIMIT ${perKindLimit}
      `)
        .map((r) => ({
          kind: "plexUser" as const,
          id: String(r.id),
          title: r.title,
          subtitle: r.subtitle ?? undefined,
          href: `/users?q=${encodeURIComponent(r.title)}`,
        })),
    );

    add("plexSection", () =>
      db
        .all<FtsRow & { type: string }>(sql`
        SELECT plex_sections.key AS id, plex_sections.title AS title, plex_sections.type AS type
        FROM plex_sections_fts
        JOIN plex_sections ON plex_sections.key = plex_sections_fts.section_key
        WHERE plex_sections_fts MATCH ${match}
        ORDER BY bm25(plex_sections_fts) LIMIT ${perKindLimit}
      `)
        .map((r) => ({
          kind: "plexSection" as const,
          id: String(r.id),
          title: r.title,
          subtitle: r.type,
          href: `/media?section=${encodeURIComponent(String(r.id))}`,
        })),
    );

    /**
     * Prerolls are matched with LIKE rather than FTS.
     *
     * Not an oversight: there is no `prerolls_fts`, and adding one means a
     * hand-written migration plus two triggers to keep in step with the schema
     * forever (see the note at the top of packages/db/src/schema.ts). The table
     * holds tens of rows on a large install — a scan costs nothing, and the
     * prefix semantics come out the same.
     */
    add("preroll", () => {
      const like = `%${query
        .trim()
        .toLowerCase()
        .replace(/[%_\\]/g, "\\$&")}%`;
      return db
        .all<{ id: string; title: string; status: string }>(sql`
        SELECT id, name AS title, status FROM prerolls
        WHERE lower(name) LIKE ${like} ESCAPE '\\' OR lower(original_filename) LIKE ${like} ESCAPE '\\'
        ORDER BY position, created_at LIMIT ${perKindLimit}
      `)
        .map((r) => ({
          kind: "preroll" as const,
          id: String(r.id),
          title: r.title,
          subtitle: r.status,
          href: `/prerolls?id=${encodeURIComponent(String(r.id))}`,
        }));
    });

    return hits;
  }

  return { searchAll };
}

export type Search = ReturnType<typeof createSearch>;

export const SearchToken = token<Search>("search");
