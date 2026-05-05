import { createPlexClient } from "@tinkerbell/plex";
import { plexHealthCallback } from "@tinkerbell/core";
import { errorMessage } from "@tinkerbell/core";
import { getConfig } from "@tinkerbell/core";
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

  ctx.log(`tinkerbell label-undo`);
  ctx.log(`Server: ${PLEX_URL}`);

  let machineId: string;
  const identity = await client.getIdentity();
  machineId = identity.machineIdentifier;
  ctx.log(`Server name: ${identity.friendlyName}`);

  // Get configured library sections
  let sections = await client.getSections();
  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    sections = sections.filter((s) => configuredLibraries.includes(s.title));
  }

  if (config.sections && config.sections.length > 0) {
    sections = sections.filter((s) => config.sections!.includes(s.title));
  }

  // Phase 1: Remove "Tinkerbell" label from all media items
  ctx.log(`Removing "Tinkerbell" label from all media items...`);
  let totalUpdated = 0;
  for (const section of sections) {
    ctx.log(`Section: ${section.title} (${section.type})`);
    const updated = await client.removeLabelFromAllItems(section.key, section.type, "Tinkerbell", (current, total) => {
      ctx.progress(current, total, `Removing labels in "${section.title}"...`);
    });
    ctx.log(`Removed label from ${updated} item(s) in "${section.title}"`);
    totalUpdated += updated;
  }
  ctx.log(`Total items unlabelled: ${totalUpdated}`);

  // Phase 2: Remove "User:" labels from collections
  ctx.log(`Removing "User:" labels from collections...`);
  let collectionsUpdated = 0;
  for (const section of sections) {
    const colls = await client.getCollections(section.key);
    for (const col of colls) {
      const labels = await client.getCollectionLabels(col.ratingKey);
      const userLabels = labels.filter((l) => l.tag.startsWith("User:"));
      if (userLabels.length === 0) continue;
      const remaining = labels.filter((l) => !l.tag.startsWith("User:")).map((l) => l.tag);
      await client.setCollectionLabels(section.key, col.ratingKey, remaining);
      ctx.log(`Removed ${userLabels.map((l) => l.tag).join(", ")} from "${col.title}"`);
      collectionsUpdated++;
    }
  }
  ctx.log(`Removed User labels from ${collectionsUpdated} collection(s)`);

  // Phase 3: Clear user sharing restrictions
  ctx.log(`Fetching shared users from plex.tv...`);
  const sharings = await client.getSharings(machineId);

  if (sharings.length === 0) {
    ctx.log(`No shared users found for this server.`);
    ctx.log(`Done — removed labels from ${totalUpdated} item(s), no users to update.`);
    return;
  }

  ctx.log(`Found ${sharings.length} shared user(s):`);
  for (const sharing of sharings) {
    ctx.log(`  ${sharing.username} (ID: ${sharing.userId})`);
  }

  let cleared = 0;
  for (const sharing of sharings) {
    ctx.progress(sharings.indexOf(sharing) + 1, sharings.length, `Clearing restrictions for "${sharing.username}"...`);
    ctx.log(`Clearing restrictions for ${sharing.username}...`);

    try {
      await client.clearSharingRestrictions(sharing.id);
      ctx.log(`Cleared sharing restrictions for ${sharing.username}`);
      cleared++;
    } catch (err) {
      ctx.log(`Failed to clear restrictions for ${sharing.username}: ${errorMessage(err)}`);
    }
  }

  ctx.log(
    `Done — removed labels from ${totalUpdated} item(s), removed User labels from ${collectionsUpdated} collection(s), cleared restrictions for ${cleared}/${sharings.length} user(s).`,
  );
}
