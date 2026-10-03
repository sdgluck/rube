import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createPlexClient } from "@tinkerbell/plex";
import { errorMessage } from "@tinkerbell/core";
import { sharingRestrictionBackups } from "@tinkerbell/db";
import { eq } from "drizzle-orm";

import type { JobContext, CommonJobConfig } from "@tinkerbell/core";

const BASELINE_LABEL = "Tinkerbell";

export function createPersonalizeDisableCommand(deps: Pick<Services, "clients" | "collections" | "config" | "db">) {
  const { clients, collections, config, db } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig, setConfig } = config;
  const { forgetCollections } = collections;

  /**
   * Disable the personalization master switch and revert the server to its
   * pre-enable state. Order matters: per-user collections are deleted FIRST,
   * while sharing restrictions are still in force, so they're never briefly
   * visible to every user once the restrictions come off.
   *
   * Idempotent: safe to re-run if interrupted.
   */
  async function run(ctx: JobContext, config: CommonJobConfig): Promise<void> {
    const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
    const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
    if (!PLEX_TOKEN) {
      throw new Error("Plex token is required. Configure it in Settings.");
    }

    setConfig("global_personalized_sharing", { status: "disabling" });

    const client = createPlexClient({
      url: PLEX_URL,
      token: PLEX_TOKEN,
      signal: ctx.signal,
      onHealth: plexHealthCallback,
    });

    ctx.log(`tinkerbell personalize-disable`);
    const identity = await client.getIdentity();
    ctx.log(`Server: ${identity.friendlyName}`);

    let sections = await client.getSections();
    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      sections = sections.filter((s) => configuredLibraries.includes(s.title));
    }
    if (config.sections && config.sections.length > 0) {
      sections = sections.filter((s) => config.sections!.includes(s.title));
    }

    try {
      // Phase 1: delete every per-user collection BEFORE lifting restrictions.
      // Per-user collections carry a `User:<name>` label; admin/shared
      // collections (Rule:<id>) do not, so those are left untouched.
      ctx.log(`Deleting per-user collections...`);
      let deleted = 0;
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        ctx.progress(i + 1, sections.length, `Scanning "${section.title}"...`);
        const collections = await client.getCollectionsWithLabels(section.key);
        for (const col of collections) {
          if (!col.labels.some((tag) => tag.startsWith("User:"))) continue;
          await client.deleteItem(col.ratingKey);
          forgetCollections([col.ratingKey]);
          ctx.log(`Deleted "${col.title}"`);
          deleted++;
        }
      }
      ctx.log(`Deleted ${deleted} per-user collection(s).`);

      // Phase 2: restore each user's snapshotted restriction (or clear it).
      const backups = db.select().from(sharingRestrictionBackups).all();
      ctx.log(`Restoring sharing restrictions for ${backups.length} user(s)...`);
      let restored = 0;
      for (const b of backups) {
        try {
          if (b.filterMovies === "" && b.filterTelevision === "") {
            await client.clearSharingRestrictions(b.sharingId);
          } else {
            await client.setSharingFilters(b.sharingId, b.filterMovies, b.filterTelevision);
          }
          // Each backup goes only once its user is restored. Clearing the table
          // wholesale after the loop threw away the only record of a user's
          // original sharing whenever their restore failed or the run was
          // aborted — and a re-run then had nothing to restore them to.
          db.delete(sharingRestrictionBackups).where(eq(sharingRestrictionBackups.sharingId, b.sharingId)).run();
          restored++;
        } catch (err) {
          if (ctx.signal.aborted) throw err;
          ctx.log(`Failed to restore ${b.username}: ${errorMessage(err)}`);
        }
      }
      ctx.log(`Restored ${restored}/${backups.length} user(s).`);
      if (restored < backups.length) {
        // Stay "disabling": users still restricted to the Tinkerbell label would
        // lose access to everything once the label comes off below.
        throw new Error(
          `Restored only ${restored} of ${backups.length} user(s) — leaving labels in place. Run it again to finish.`,
        );
      }

      // Phase 3: remove the baseline label from every item.
      ctx.log(`Removing "${BASELINE_LABEL}" label from all items...`);
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const updated = await client.removeLabelFromAllItems(
          section.key,
          section.type,
          BASELINE_LABEL,
          (current, total) => {
            ctx.progress(current, total, `Unlabelling "${section.title}" (${i + 1}/${sections.length})...`);
          },
        );
        ctx.log(`Removed label from ${updated} item(s) in "${section.title}"`);
      }

      setConfig("global_personalized_sharing", { status: "disabled" });
      ctx.log(`Personalization disabled.`);
    } catch (err) {
      // Leave status as "disabling" so a re-run can finish (idempotent).
      ctx.log(`Disable failed: ${errorMessage(err)}`);
      throw err;
    }
  }

  return { run };
}

/**
 * The command entrypoint, unchanged in shape: the runner and the Sidequest
 * worker both still call `default(ctx, config)`. What changed is where the
 * work gets its dependencies — the run's own container scope, rather than
 * whatever the module graph happened to have initialised.
 */
export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createPersonalizeDisableCommand>["run"]>[1],
): Promise<void> {
  return createPersonalizeDisableCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
