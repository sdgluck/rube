import { createPlexClient } from "../plex.ts";
import { getConfig } from "../config.ts";
import type { JobContext, CommonJobConfig } from "../../shared/job-context.ts";

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

  // Phase 2: Clear user sharing restrictions
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
      ctx.log(`Failed to clear restrictions for ${sharing.username}: ${(err as Error).message}`);
    }
  }

  ctx.log(
    `Done — removed labels from ${totalUpdated} item(s), cleared restrictions for ${cleared}/${sharings.length} user(s).`,
  );
}
