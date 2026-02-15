import { createPlexClient } from "../plex.ts";
import { getConfig } from "../config.ts";

interface LabelArgs {
  url?: string;
  token?: string;
  sections?: string;
  verbose?: boolean;
}

export default async function run(args: LabelArgs): Promise<void> {
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

  console.log(`🏷️  tinkerbell label`);
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

  // Get sharings from plex.tv
  console.log(`\n📋 Fetching shared users from plex.tv...`);
  const sharings = await client.getSharings(machineId);

  if (sharings.length === 0) {
    console.log(`   No shared users found for this server.`);
    console.log(`\n✅ Nothing to configure.`);
    return;
  }

  console.log(`   Found ${sharings.length} shared user(s):`);
  for (const sharing of sharings) {
    console.log(`     • ${sharing.username} (ID: ${sharing.userId})`);
  }

  // Configure each user's sharing restrictions
  let configured = 0;
  for (const sharing of sharings) {
    console.log(`§PROGRESS:${sharings.indexOf(sharing) + 1}/${sharings.length}:Configuring "${sharing.username}"...`);

    const labels = ["Tinkerbell", `User:${sharing.username}`];
    console.log(`\n🏷️  Configuring ${sharing.username}...`);
    console.log(`   Labels: ${labels.join(", ")}`);

    try {
      await client.setSharingRestrictions(sharing.id, labels);
      console.log(`   ✅ Set sharing restriction for ${sharing.username}`);
      configured++;
    } catch (err) {
      console.error(`   ❌ Failed to set restriction for ${sharing.username}: ${(err as Error).message}`);
    }
  }

  console.log(`\n🎉 Configured ${configured}/${sharings.length} user(s).`);
  console.log(`   Each user can see: collections with label "Tinkerbell" + "User:{username}"`);
  console.log(`   Admin/owner sees everything (no restriction applied).`);
}
