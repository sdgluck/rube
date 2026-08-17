import { createPlexClient } from "@tinkerbell/plex";
import { plexHealthCallback } from "@tinkerbell/core";
import { getConfig } from "@tinkerbell/core";
import { syncMedia } from "@tinkerbell/domain.media";
import { runTriggeredRules } from "../rule-triggers.ts";
import type { JobContext, CommonJobConfig } from "@tinkerbell/core";

export default async function run(ctx: JobContext, config: CommonJobConfig): Promise<void> {
  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;

  if (!PLEX_TOKEN) {
    throw new Error("Plex token is required. Configure it in Settings.");
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    signal: ctx.signal,
    onHealth: plexHealthCallback,
  });

  ctx.log(`tinkerbell sync-media`);
  ctx.log(`Server: ${PLEX_URL}`);

  const identity = await client.getIdentity();
  ctx.log(`Server name: ${identity.friendlyName}`);

  let allSections = await client.getSections();

  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
  }

  let sections;
  if (config.sections && config.sections.length > 0) {
    const names = config.sections.map((s) => s.trim().toLowerCase());
    sections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
    if (sections.length === 0) {
      throw new Error(`No matching sections found for "${config.sections.join(", ")}".`);
    }
  } else {
    sections = allSections;
  }

  ctx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);

  // Resume a sync the previous run abandoned. Section granularity: the
  // per-item seam inside `syncMedia` isn't clean (paging state lives in the
  // Plex client's iterator), and a section is a small enough unit that
  // redoing one costs little.
  //
  // The watermark carries across runs deliberately — see `SyncMediaOptions`.
  const saved = ctx.checkpoint.read<SyncMediaCheckpoint>();
  const resumable = saved && sameSections(saved.sectionKeys, sections);
  if (saved && !resumable) {
    ctx.log("Section selection changed since the last run — starting from scratch.");
  }
  const syncedAt = resumable ? saved.syncedAt : Date.now();
  const done = resumable ? saved.completedSectionKeys : [];
  if (done.length > 0) {
    ctx.log(`Resuming: skipping ${done.length} section(s) completed in the previous run.`);
  }

  ctx.log(`Syncing media items...`);

  const completed = [...done];
  const stats = await syncMedia(client, sections, (current, total, message) => ctx.progress(current, total, message), {
    syncedAt,
    skipSectionKeys: completed,
    onSectionComplete: (sectionKey) => {
      completed.push(sectionKey);
      ctx.checkpoint.write({
        syncedAt,
        sectionKeys: sections.map((s) => s.key),
        completedSectionKeys: completed,
      } satisfies SyncMediaCheckpoint);
    },
  });

  // The stale sweep has run, so there is nothing left to resume.
  ctx.checkpoint.clear();
  ctx.log(`Done! Synced ${stats.synced} item(s), removed ${stats.removed} stale.`);

  // The removed-item trigger rides on this job for the same reason the added
  // one rides on the recently-added sync: this is already the thing that knows
  // what vanished. It runs after the checkpoint is cleared, so a rule that
  // fails here doesn't cost the sync its resumability.
  const triggered = await runTriggeredRules(ctx, "item-removed", stats.removed);
  if (triggered) ctx.log(triggered);
}

interface SyncMediaCheckpoint {
  /** The `syncedAt` watermark the interrupted run stamped its rows with. */
  syncedAt: number;
  /** The full section list at the time — a different one invalidates the checkpoint. */
  sectionKeys: string[];
  completedSectionKeys: string[];
}

function sameSections(saved: string[], current: { key: string }[]): boolean {
  if (saved.length !== current.length) return false;
  const keys = new Set(current.map((s) => s.key));
  return saved.every((k) => keys.has(k));
}
