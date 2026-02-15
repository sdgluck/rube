import { createPlexClient } from "../plex.ts";
import { getConfig } from "../config.ts";

interface LabelUndoArgs {
  url?: string;
  token?: string;
  sections?: string;
  verbose?: boolean;
}

export default async function run(args: LabelUndoArgs): Promise<void> {
  const PLEX_URL = (
    args.url ||
    getConfig("global_plex_url") ||
    process.env.PLEX_URL ||
    "http://localhost:32400"
  ).replace(/\/+$/, "");
  const PLEX_TOKEN = args.token || getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  const VERBOSE = args.verbose;

  if (!PLEX_TOKEN) {
    console.error("Error: Plex token is required. Use --token or set PLEX_TOKEN.");
    process.exit(1);
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    verbose: VERBOSE,
  });

  console.log(`🏷️  tinkerbell label-undo`);
  console.log(`   Server: ${PLEX_URL}`);

  let machineId: string;
  try {
    const identity = await client.getIdentity();
    machineId = identity.machineIdentifier;
    console.log(`   Server name: ${identity.friendlyName}`);
  } catch (err) {
    console.error(`\n❌ Could not connect to Plex server at ${PLEX_URL}`);
    console.error(`   ${(err as Error).message}`);
    process.exit(1);
  }

  // Get configured library sections
  let sections = await client.getSections();
  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    sections = sections.filter((s) => configuredLibraries.includes(s.title));
  }

  if (args.sections) {
    const allowed = args.sections.split(",").map((s) => s.trim());
    sections = sections.filter((s) => allowed.includes(s.title));
  }

  // Phase 1: Remove "Tinkerbell" label from all media items
  console.log(`\n🏷️  Removing "Tinkerbell" label from all media items...`);
  let totalUpdated = 0;
  for (const section of sections) {
    console.log(`\n   Section: ${section.title} (${section.type})`);
    const updated = await client.removeLabelFromAllItems(section.key, section.type, "Tinkerbell", (current, total) => {
      console.log(`§PROGRESS:${current}/${total}:Removing labels in "${section.title}"...`);
    });
    console.log(`   ✅ Removed label from ${updated} item(s) in "${section.title}"`);
    totalUpdated += updated;
  }
  console.log(`\n   Total items unlabelled: ${totalUpdated}`);

  // Phase 2: Clear user sharing restrictions
  console.log(`\n📋 Fetching shared users from plex.tv...`);
  const sharings = await client.getSharings(machineId);

  if (sharings.length === 0) {
    console.log(`   No shared users found for this server.`);
    console.log(`\n✅ Done — removed labels from ${totalUpdated} item(s), no users to update.`);
    return;
  }

  console.log(`   Found ${sharings.length} shared user(s):`);
  for (const sharing of sharings) {
    console.log(`     • ${sharing.username} (ID: ${sharing.userId})`);
  }

  let cleared = 0;
  for (const sharing of sharings) {
    console.log(
      `§PROGRESS:${sharings.indexOf(sharing) + 1}/${sharings.length}:Clearing restrictions for "${sharing.username}"...`,
    );
    console.log(`\n🏷️  Clearing restrictions for ${sharing.username}...`);

    try {
      await client.clearSharingRestrictions(sharing.id);
      console.log(`   ✅ Cleared sharing restrictions for ${sharing.username}`);
      cleared++;
    } catch (err) {
      console.error(`   ❌ Failed to clear restrictions for ${sharing.username}: ${(err as Error).message}`);
    }
  }

  console.log(
    `\n🎉 Done — removed labels from ${totalUpdated} item(s), cleared restrictions for ${cleared}/${sharings.length} user(s).`,
  );
}
