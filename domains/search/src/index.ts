import { sql } from "drizzle-orm";
import { db } from "@tinkerbell/db";

export type SearchKind =
  | "collection"
  | "media"
  | "rule"
  | "job"
  | "overlayPreset"
  | "event"
  | "plexUser"
  | "plexSection";

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

export function searchAll(query: string, perKindLimit = 8): SearchHit[] {
  const match = buildMatch(query);
  if (!match) return [];

  const hits: SearchHit[] = [];

  for (const r of db.all<FtsRow>(sql`
    SELECT collections.plex_rating_key AS id, collections.title AS title, collections.section_title AS subtitle
    FROM collections_fts
    JOIN collections ON collections.plex_rating_key = collections_fts.plex_rating_key
    WHERE collections_fts MATCH ${match}
    ORDER BY bm25(collections_fts) LIMIT ${perKindLimit}
  `)) {
    hits.push({
      kind: "collection",
      id: String(r.id),
      title: r.title,
      subtitle: r.subtitle ?? undefined,
      href: `/collections?q=${encodeURIComponent(r.title)}`,
    });
  }

  for (const r of db.all<FtsRow & { year: number | null }>(sql`
    SELECT media_items.rating_key AS id, media_items.title AS title,
           media_items.section_title AS subtitle, media_items.year AS year
    FROM media_items_fts
    JOIN media_items ON media_items.rating_key = media_items_fts.rating_key
    WHERE media_items_fts MATCH ${match}
    ORDER BY bm25(media_items_fts) LIMIT ${perKindLimit}
  `)) {
    const sub = [r.subtitle, r.year ? String(r.year) : null].filter(Boolean).join(" · ");
    hits.push({
      kind: "media",
      id: String(r.id),
      title: r.title,
      subtitle: sub || undefined,
      href: `/media?q=${encodeURIComponent(r.title)}`,
    });
  }

  for (const r of db.all<FtsRow>(sql`
    SELECT rules.id AS id, rules.name AS title, rules.type AS subtitle
    FROM rules_fts
    JOIN rules ON rules.id = rules_fts.id
    WHERE rules_fts MATCH ${match}
    ORDER BY bm25(rules_fts) LIMIT ${perKindLimit}
  `)) {
    hits.push({
      kind: "rule",
      id: String(r.id),
      title: r.title,
      subtitle: r.subtitle ?? undefined,
      href: `/rules?id=${encodeURIComponent(String(r.id))}`,
    });
  }

  for (const r of db.all<FtsRow>(sql`
    SELECT jobs.id AS id, jobs.name AS title, jobs.command AS subtitle
    FROM jobs_fts
    JOIN jobs ON jobs.id = jobs_fts.id
    WHERE jobs_fts MATCH ${match}
    ORDER BY bm25(jobs_fts) LIMIT ${perKindLimit}
  `)) {
    hits.push({
      kind: "job",
      id: String(r.id),
      title: r.title,
      subtitle: r.subtitle ?? undefined,
      href: `/jobs?id=${encodeURIComponent(String(r.id))}`,
    });
  }

  for (const r of db.all<FtsRow>(sql`
    SELECT overlay_presets.id AS id, overlay_presets.name AS title,
           overlay_presets.description AS subtitle
    FROM overlay_presets_fts
    JOIN overlay_presets ON overlay_presets.id = overlay_presets_fts.id
    WHERE overlay_presets_fts MATCH ${match}
    ORDER BY bm25(overlay_presets_fts) LIMIT ${perKindLimit}
  `)) {
    hits.push({
      kind: "overlayPreset",
      id: String(r.id),
      title: r.title,
      subtitle: r.subtitle ?? undefined,
      href: `/overlays?presetId=${encodeURIComponent(String(r.id))}`,
    });
  }

  for (const r of db.all<FtsRow>(sql`
    SELECT events.id AS id, events.message AS title, events.type AS subtitle
    FROM events_fts
    JOIN events ON events.id = events_fts.event_id
    WHERE events_fts MATCH ${match}
    ORDER BY bm25(events_fts) LIMIT ${perKindLimit}
  `)) {
    hits.push({
      kind: "event",
      id: String(r.id),
      title: r.title,
      subtitle: r.subtitle ?? undefined,
      href: `/events?q=${encodeURIComponent(r.title)}`,
    });
  }

  for (const r of db.all<FtsRow>(sql`
    SELECT plex_users.user_id AS id,
           COALESCE(NULLIF(plex_users.name, ''), plex_users.username) AS title,
           plex_users.username AS subtitle
    FROM plex_users_fts
    JOIN plex_users ON plex_users.user_id = plex_users_fts.user_id
    WHERE plex_users_fts MATCH ${match}
    ORDER BY bm25(plex_users_fts) LIMIT ${perKindLimit}
  `)) {
    hits.push({
      kind: "plexUser",
      id: String(r.id),
      title: r.title,
      subtitle: r.subtitle ?? undefined,
      href: `/users?q=${encodeURIComponent(r.title)}`,
    });
  }

  for (const r of db.all<FtsRow & { type: string }>(sql`
    SELECT plex_sections.key AS id, plex_sections.title AS title, plex_sections.type AS type
    FROM plex_sections_fts
    JOIN plex_sections ON plex_sections.key = plex_sections_fts.section_key
    WHERE plex_sections_fts MATCH ${match}
    ORDER BY bm25(plex_sections_fts) LIMIT ${perKindLimit}
  `)) {
    hits.push({
      kind: "plexSection",
      id: String(r.id),
      title: r.title,
      subtitle: r.type,
      href: `/media?section=${encodeURIComponent(String(r.id))}`,
    });
  }

  return hits;
}
