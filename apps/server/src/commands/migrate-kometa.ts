import { createPlexClient } from "@tinkerbell/plex";
import { plexHealthCallback } from "@tinkerbell/core";
import { getConfig, setConfig, deleteConfig } from "@tinkerbell/core";
import { createRule } from "#domains/rules.ts";
import { markMigrationCompleted, scanKometaState } from "#domains/migration.ts";
import type { CommonJobConfig, JobContext } from "@tinkerbell/core";

export default async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
  ctx.log("tinkerbell migrate-kometa");

  const pending = getConfig("migration_kometa_pending_plan");
  if (!pending) {
    ctx.log("No pending migration plan found — aborting.");
    return;
  }

  const { items, deleteOriginals } = pending;
  ctx.log(`Plan: ${items.length} rule(s) to create, deleteOriginals=${deleteOriginals}`);

  const totalSteps = items.length + (deleteOriginals ? items.length : 0);
  let step = 0;

  // 1. Create rules (disabled by default per the migration design)
  for (const item of items) {
    ctx.signal?.throwIfAborted();
    step++;
    ctx.progress(step, totalSteps, `Creating rule "${item.ruleName}"...`);
    const rule = createRule({
      name: item.ruleName,
      type: item.ruleType,
      config: item.ruleConfig,
      enabled: false,
    });
    ctx.log(`Created rule "${rule.name}" (${rule.type}, id=${rule.id}, disabled).`);
  }

  // 2. Optionally delete the original Kometa-labelled collections this
  // migration is replacing. We delete the *specific* rating keys the plan
  // pinned, not a blanket label sweep, so untouched Kometa collections
  // (e.g. unmappable ones the user kept) survive.
  if (deleteOriginals) {
    const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
    const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
    if (!PLEX_TOKEN) {
      ctx.log("Plex token missing — skipping originals delete.");
    } else {
      const client = createPlexClient({
        url: PLEX_URL,
        token: PLEX_TOKEN,
        signal: ctx.signal,
        onHealth: plexHealthCallback,
      });

      let deleted = 0;
      let failed = 0;
      for (const item of items) {
        ctx.signal?.throwIfAborted();
        step++;
        ctx.progress(step, totalSteps, `Deleting originals for "${item.ruleName}"...`);
        for (const ratingKey of item.replacesRatingKeys) {
          try {
            await client.deleteItem(ratingKey);
            deleted++;
          } catch (err) {
            failed++;
            ctx.log(`Failed to delete collection ratingKey=${ratingKey}: ${(err as Error).message ?? err}`);
          }
        }
      }
      ctx.log(`Deleted ${deleted} original Kometa collection(s)${failed ? `, ${failed} failed` : ""}.`);
    }
  }

  // 3. Refresh scan state and mark migration complete so the banner stays
  // dismissed even after future syncs reveal additional Kometa collections.
  scanKometaState();
  markMigrationCompleted();
  // Setting completed_at suppresses the banner; leftover state in
  // `_pending_plan` is no longer useful.
  deleteConfig("migration_kometa_pending_plan");
  // Touch dismissed_at too so the banner doesn't briefly reappear if the
  // next sync increments the count before the user navigates away.
  setConfig("migration_kometa_dismissed_at", Date.now());

  ctx.log("Migration complete.");
}
