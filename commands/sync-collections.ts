import { createPlexClient } from "../plex.ts";
import { getConfig } from "../config.ts";
import { syncCollections } from "../collections.ts";

interface SyncCollectionsArgs {
  url?: string;
  token?: string;
  sections?: string;
  verbose?: boolean;
}

export default async function run(args: SyncCollectionsArgs): Promise<void> {
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

  console.log(`🔄 tinkerbell sync-collections`);
  console.log(`   Server: ${PLEX_URL}`);

  try {
    const identity = await client.getIdentity();
    console.log(`   Server name: ${identity.friendlyName}`);
  } catch (err) {
    console.error(`\n❌ Could not connect to Plex server at ${PLEX_URL}`);
    console.error(`   ${(err as Error).message}`);
    process.exit(1);
  }

  let allSections = await client.getSections();

  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
  }

  let sections;
  if (args.sections) {
    const names = args.sections.split(",").map((s) => s.trim().toLowerCase());
    sections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
    if (sections.length === 0) {
      console.error(`\n❌ No matching sections found for "${args.sections}".`);
      console.error("   Available sections:");
      allSections.forEach((s) => console.error(`     [${s.key}] ${s.title} (${s.type})`));
      process.exit(1);
    }
  } else {
    sections = allSections;
  }

  console.log(`   Sections: ${sections.map((s) => s.title).join(", ")}`);
  console.log(`\n   Syncing collections...`);

  const stats = await syncCollections(client, sections);

  console.log(`\n🎉 Done! Synced ${stats.synced} collection(s), removed ${stats.removed} stale.`);
}
