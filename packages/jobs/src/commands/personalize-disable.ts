import { createPlexClient } from "@tinkerbell/plex";
import { plexHealthCallback, errorMessage, getConfig, setConfig } from "@tinkerbell/core";
import { db, sharingRestrictionBackups } from "@tinkerbell/db";
import { forgetCollections } from "@tinkerbell/domain.collections";
import type { JobContext, CommonJobConfig } from "@tinkerbell/core";

const BASELINE_LABEL = "Tinkerbell";

/**
 * Disable the personalization master switch and revert the server to its
 * pre-enable state. Order matters: per-user collections are deleted FIRST,
 * while sharing restrictions are still in force, so they're never briefly
 * visible to every user once the restrictions come off.
 *
 * Idempotent: safe to re-run if interrupted.
 */
export default async function run(ctx: JobContext, config: CommonJobConfig): Promise<void> {
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
      const collections = await client.getCollections(section.key);
      for (const col of collections) {
        const labels = await client.getCollectionLabels(col.ratingKey);
        if (!labels.some((l) => l.tag.startsWith("User:"))) continue;
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
        restored++;
      } catch (err) {
        ctx.log(`Failed to restore ${b.username}: ${errorMessage(err)}`);
      }
    }
    db.delete(sharingRestrictionBackups).run();
    ctx.log(`Restored ${restored}/${backups.length} user(s).`);

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
