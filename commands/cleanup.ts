import { createPlexClient, type PlexSection } from "../plex.ts";
import { getConfig } from "../config.ts";

interface CleanupArgs {
  url?: string;
  token?: string;
  sections?: string;
  from?: string;
  all?: boolean;
  verbose?: boolean;
}

export default async function run(args: CleanupArgs): Promise<void> {
  const PLEX_URL = (
    args.url ||
    getConfig("global_plex_url") ||
    process.env.PLEX_URL ||
    "http://localhost:32400"
  ).replace(/\/+$/, "");
  const PLEX_TOKEN = args.token || getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  const DELETE_ALL = args.all;
  const FROM_DATE = args.from ? Math.floor(new Date(args.from).getTime() / 1000) : null;
  const VERBOSE = args.verbose;

  if (args.from && !FROM_DATE) {
    console.error("Error: Invalid date for --from. Use YYYY-MM-DD format.");
    process.exit(1);
  }

  if (!PLEX_TOKEN) {
    console.error("Error: Plex token is required. Use --token or set PLEX_TOKEN.");
    process.exit(1);
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    verbose: VERBOSE,
  });

  async function cleanupSection(section: PlexSection): Promise<number> {
    const sectionId = section.key;
    const sectionTitle = section.title;

    console.log(`\n🧹 "${sectionTitle}" — fetching collections...`);

    const collections = await client.getCollections(sectionId);

    if (collections.length === 0) {
      console.log(`   No collections found.`);
      return 0;
    }

    console.log(`   Found ${collections.length} collection(s).`);

    let deleted = 0;
    for (const col of collections) {
      if (DELETE_ALL) {
        console.log(`   🗑  "${col.title}" — deleted`);
        await client.deleteItem(col.ratingKey);
        deleted++;
        continue;
      }

      const labels = await client.getCollectionLabels(col.ratingKey);
      const isTinkerbell = labels.some((l) => l.tag.toLowerCase() === "tinkerbell");
      const isAfterFrom = FROM_DATE && col.addedAt! >= FROM_DATE;

      if (isTinkerbell || isAfterFrom) {
        console.log(`   🗑  "${col.title}" — deleted`);
        await client.deleteItem(col.ratingKey);
        deleted++;
      } else {
        console.log(`   ⏭  "${col.title}" — skipped`);
      }
    }

    console.log(`   ✅ Deleted ${deleted} collection(s) from "${sectionTitle}".`);
    return deleted;
  }

  console.log(`🧹 tinkerbell cleanup${DELETE_ALL ? " (ALL collections)" : ""}`);
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

  let total = 0;
  for (const section of sections) {
    console.log(`§PROGRESS:${sections.indexOf(section) + 1}/${sections.length}:Cleaning "${section.title}"...`);
    total += await cleanupSection(section);
  }

  console.log(`\n🎉 Done! Deleted ${total} collection(s) total.`);
}
