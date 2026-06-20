/**
 * Seeds the throwaway capture DB with the synthetic dataset. Run as a child
 * process with DATA_DIR + MOCK_PLEX_URL set, so @tinkerbell/db resolves to the
 * isolated database and the stored Plex config points at the mock origin.
 *
 * Invoked by capture.ts; not meant to touch a real tinkerbell.db.
 */

import { db, plexSections, plexUsers, collections, collectionItems, mediaItems, rules, events } from "@tinkerbell/db";
import { setConfig } from "@tinkerbell/core";
import { SECTIONS, ITEMS, COLLECTIONS, RULES, USERS, EVENTS, thumbPath } from "./data.ts";

const mockUrl = process.env.MOCK_PLEX_URL;
if (!mockUrl) throw new Error("MOCK_PLEX_URL is required");

const now = Date.now();
const min = 60_000;

// ── Config: point the app at the mock Plex so /api/plex-image resolves ──────
setConfig("global_plex_url", mockUrl);
setConfig("global_plex_token", "demo-token");
setConfig(
  "global_plex_libraries",
  SECTIONS.map((s) => s.title),
);

// ── Plex sections (so plexSections reads the local cache, never live Plex) ──
for (const s of SECTIONS) {
  db.insert(plexSections)
    .values({ key: s.key, title: s.title, type: s.type, syncedAt: now })
    .onConflictDoNothing()
    .run();
}

// ── Media items ─────────────────────────────────────────────────────────────
for (const it of ITEMS) {
  db.insert(mediaItems)
    .values({
      ratingKey: it.ratingKey,
      sectionId: it.sectionId,
      sectionTitle: it.sectionTitle,
      title: it.title,
      year: it.year,
      thumb: thumbPath(it.ratingKey),
      type: it.type,
      addedAt: now - Math.floor(Math.random() * 30) * 24 * 60 * min,
      videoResolution: it.videoResolution,
      videoCodec: it.videoCodec,
      audioCodec: it.audioCodec,
      audioChannels: it.audioChannels,
      container: it.container,
      syncedAt: now,
    })
    .onConflictDoNothing()
    .run();
}

// ── Collections + their items ───────────────────────────────────────────────
for (const c of COLLECTIONS) {
  db.insert(collections)
    .values({
      plexRatingKey: c.ratingKey,
      sectionId: c.sectionId,
      sectionTitle: c.sectionTitle,
      title: c.title,
      summary: c.summary,
      childCount: c.itemRatingKeys.length,
      labels: c.labels,
      addedAt: now,
      thumb: thumbPath(c.ratingKey),
      smart: c.smart ? 1 : 0,
      smartFilter: c.smart ? `/library/sections/${c.sectionId}/all?sort=rating` : "",
      syncedAt: now,
    })
    .onConflictDoNothing()
    .run();
  for (const itemKey of c.itemRatingKeys) {
    db.insert(collectionItems)
      .values({ collectionRatingKey: c.ratingKey, itemRatingKey: itemKey })
      .onConflictDoNothing()
      .run();
  }
}

// ── Rules with run history ──────────────────────────────────────────────────
RULES.forEach((r, i) => {
  db.insert(rules)
    .values({
      id: r.id,
      name: r.name,
      type: r.type,
      enabled: r.enabled ? 1 : 0,
      config: {},
      createdAt: now - (i + 1) * 3 * 24 * 60 * min,
      lastCollectionRatingKey: COLLECTIONS[i]?.ratingKey ?? null,
      lastRunAt: now - (i + 1) * 17 * min,
      lastRunDurationMs: 800 + i * 230,
      lastRunCollectionCount: r.collectionCount,
      lastRunItemCount: r.itemCount,
      lastRunStatus: r.status,
      lastRunError: r.status === "error" ? "OMDb rate limit exceeded (429)" : null,
    })
    .onConflictDoNothing()
    .run();
});

// ── Plex users ──────────────────────────────────────────────────────────────
for (const u of USERS) {
  db.insert(plexUsers)
    .values({
      userId: u.userId,
      username: u.username,
      name: u.name,
      label: `User:${u.name}`,
      collectionCount: u.collectionCount,
      lastWatchedTitle: u.lastWatched,
      lastWatchedAt: now - u.agoMin * min,
      syncedAt: now,
    })
    .onConflictDoNothing()
    .run();
}

// ── Events / activity feed ──────────────────────────────────────────────────
for (const e of EVENTS) {
  db.insert(events)
    .values({ type: e.type, message: e.message, metadata: null, timestamp: now - e.agoMin * min })
    .run();
}

console.log(
  `[seed] ${ITEMS.length} media · ${COLLECTIONS.length} collections · ${RULES.length} rules · ${USERS.length} users · ${EVENTS.length} events`,
);
