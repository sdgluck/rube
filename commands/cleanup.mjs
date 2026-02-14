import { createPlexClient } from "../plex.mjs";

export default async function run(args) {
  const PLEX_URL = (
    args.url ||
    process.env.PLEX_URL ||
    "http://localhost:32400"
  ).replace(/\/+$/, "");
  const PLEX_TOKEN = args.token || process.env.PLEX_TOKEN;
  const DELETE_ALL = args.all;
  const FROM_DATE = args.from
    ? Math.floor(new Date(args.from).getTime() / 1000)
    : null;
  const VERBOSE = args.verbose;

  if (args.from && !FROM_DATE) {
    console.error("Error: Invalid date for --from. Use YYYY-MM-DD format.");
    process.exit(1);
  }

  if (!PLEX_TOKEN) {
    console.error(
      "Error: Plex token is required. Use --token or set PLEX_TOKEN.",
    );
    process.exit(1);
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    verbose: VERBOSE,
  });

  async function cleanupSection(section) {
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
      const isTinkerbell = labels.some((l) =>
        l.tag.toLowerCase().startsWith("tinkerbell"),
      );
      const isAfterFrom = FROM_DATE && col.addedAt >= FROM_DATE;

      if (isTinkerbell || isAfterFrom) {
        console.log(`   🗑  "${col.title}" — deleted`);
        await client.deleteItem(col.ratingKey);
        deleted++;
      } else {
        console.log(`   ⏭  "${col.title}" — skipped`);
      }
    }

    console.log(
      `   ✅ Deleted ${deleted} collection(s) from "${sectionTitle}".`,
    );
    return deleted;
  }

  console.log(`🧹 tinkerbell cleanup${DELETE_ALL ? " (ALL collections)" : ""}`);
  console.log(`   Server: ${PLEX_URL}`);

  try {
    const identity = await client.getIdentity();
    console.log(`   Server name: ${identity.friendlyName}`);
  } catch (err) {
    console.error(`\n❌ Could not connect to Plex server at ${PLEX_URL}`);
    console.error(`   ${err.message}`);
    process.exit(1);
  }

  const allSections = await client.getSections();

  let sections;
  if (args.section) {
    const match = allSections.find(
      (s) =>
        s.key === args.section ||
        s.title.toLowerCase() === args.section.toLowerCase(),
    );
    if (!match) {
      console.error(`\n❌ Section "${args.section}" not found.`);
      console.error("   Available sections:");
      allSections.forEach((s) =>
        console.error(`     [${s.key}] ${s.title} (${s.type})`),
      );
      process.exit(1);
    }
    sections = [match];
  } else {
    sections = allSections;
  }

  console.log(`   Sections: ${sections.map((s) => s.title).join(", ")}`);

  let total = 0;
  for (const section of sections) {
    total += await cleanupSection(section);
  }

  console.log(`\n🎉 Done! Deleted ${total} collection(s) total.`);
}
