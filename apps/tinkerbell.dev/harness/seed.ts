/**
 * Seeds the throwaway capture DB with the synthetic dataset. Run as a child
 * process with DATA_DIR + MOCK_PLEX_URL set, so @tinkerbell/db resolves to the
 * isolated database and the stored Plex config points at the mock origin.
 *
 * Invoked by capture.ts; not meant to touch a real tinkerbell.db.
 */

import {
  db,
  plexSections,
  plexUsers,
  collections,
  collectionItems,
  mediaItems,
  rules,
  events,
  jobs,
  jobRuns,
  prerolls,
  healthChecks,
  userPreferences,
} from "@tinkerbell/db";
import { setConfig } from "@tinkerbell/core";
import {
  SECTIONS,
  ITEMS,
  COLLECTIONS,
  RULES,
  USERS,
  EVENTS,
  PREROLLS,
  JOB_RUNS,
  HEALTH,
  SERVICE_CONFIG,
  LLM_CONFIG,
  thumbPath,
} from "./data.ts";
import { FIXED_NOW, DAY, MINUTE, fnv1a } from "./clock.ts";

const mockUrl = process.env.MOCK_PLEX_URL;
if (!mockUrl) throw new Error("MOCK_PLEX_URL is required");

// Every timestamp hangs off the one frozen instant, so a re-run writes the
// same bytes. See clock.ts.
const now = FIXED_NOW;
const min = MINUTE;

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
      // Scattered over the last month but stable per item — random() here
      // would reorder the Media list on every capture.
      addedAt: now - (fnv1a(it.ratingKey) % 30) * DAY,
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

// ── Integration config, so Settings forms show a configured service ─────────
for (const [key, value] of Object.entries(SERVICE_CONFIG)) {
  setConfig(key as keyof typeof SERVICE_CONFIG, value);
}
setConfig("global_llm", LLM_CONFIG);

// ── Prerolls ────────────────────────────────────────────────────────────────
for (const p of PREROLLS) {
  db.insert(prerolls)
    .values({
      id: p.id,
      name: p.name,
      originalFilename: `${p.name.toLowerCase().replace(/\s+/g, "-")}.mov`,
      filename: p.status === "ready" ? `${p.id}.mp4` : "",
      status: p.status,
      enabled: p.enabled ? 1 : 0,
      position: p.position,
      sizeBytes: p.sizeBytes,
      durationMs: p.durationMs,
      width: p.width,
      height: p.height,
      fps: p.status === "ready" ? 24 : 0,
      videoCodec: p.videoCodec,
      audioCodec: p.audioCodec,
      container: p.status === "ready" ? "mp4" : "",
      transcodeAction: p.transcodeAction,
      transcodeReasons: p.transcodeReasons,
      error: p.error,
      createdAt: now - p.position * 40 * min,
      updatedAt: now - p.position * 40 * min,
    })
    .onConflictDoNothing()
    .run();
}

// ── Job runs ────────────────────────────────────────────────────────────────
// The job rows are normally created by the server at boot, but job_runs.job_id
// is a foreign key — so insert the parent first rather than depend on ordering.
for (const jobId of new Set(JOB_RUNS.map((r) => r.jobId))) {
  db.insert(jobs)
    .values({ id: jobId, name: jobId, command: jobId, schedule: "", enabled: 1, config: {} })
    .onConflictDoNothing()
    .run();
}
for (const r of JOB_RUNS) {
  const startedAt = now - r.agoMin * min;
  db.insert(jobRuns)
    .values({
      id: r.id,
      jobId: r.jobId,
      status: r.status,
      log: r.log,
      progress: r.progress,
      message: r.message,
      startedAt,
      finishedAt: r.status === "running" ? null : startedAt + r.durationMs,
    })
    .onConflictDoNothing()
    .run();
}

// ── Health history ──────────────────────────────────────────────────────────
for (const h of HEALTH) {
  // A short history each, so the Health page's 24h sparkline has something to
  // draw rather than a flat empty bar.
  for (let i = 0; i < 6; i++) {
    db.insert(healthChecks)
      .values({
        service: h.service,
        // Only the newest entry carries the failure, so the sparkline shows a
        // service that recently broke rather than one that never worked.
        status: i === 0 ? h.status : "ok",
        message: i === 0 ? h.message : "OK",
        timestamp: now - h.agoMin * min - i * 4 * 60 * min,
      })
      .run();
  }
}

// ── Portal opt-in, so Users shows both pill states ──────────────────────────
for (const u of USERS.slice(0, 2)) {
  db.insert(userPreferences)
    .values({ userId: u.userId, preferences: {}, optedIn: 1, updatedAt: now })
    .onConflictDoNothing()
    .run();
}

console.log(
  `[seed] ${ITEMS.length} media · ${COLLECTIONS.length} collections · ${RULES.length} rules · ${USERS.length} users · ${EVENTS.length} events · ${PREROLLS.length} prerolls · ${JOB_RUNS.length} runs`,
);
