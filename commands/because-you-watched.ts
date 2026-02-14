import Anthropic from "@anthropic-ai/sdk";
import { createPlexClient, type PlexClient, type PlexItem } from "../plex.ts";
import { getConfig } from "../config.ts";

const BYW_LABEL = "tinkerbell:byw";

interface BywArgs {
  url?: string;
  token?: string;
  user?: string;
  section?: string;
  limit?: string;
  verbose?: boolean;
}

interface AiCollection {
  name: string;
  items: string[];
}

export default async function run(args: BywArgs): Promise<void> {
  const PLEX_URL = (args.url || getConfig("plex_url") || process.env.PLEX_URL || "http://localhost:32400").replace(
    /\/+$/,
    "",
  );
  const PLEX_TOKEN = args.token || getConfig("plex_token") || process.env.PLEX_TOKEN;
  const ANTHROPIC_API_KEY = getConfig("anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
  const LIMIT = Math.min(parseInt(args.limit!, 10) || 10, 20);
  const VERBOSE = args.verbose;

  if (!PLEX_TOKEN) {
    console.error("Error: Plex token is required. Use --token or set PLEX_TOKEN.");
    process.exit(1);
  }

  if (!ANTHROPIC_API_KEY) {
    console.error(
      "Error: Anthropic API key is required. Set it via the admin UI, ANTHROPIC_API_KEY env var, or config.",
    );
    process.exit(1);
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    verbose: VERBOSE,
  });

  console.log(`🧚 tinkerbell because-you-watched`);
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

  // Resolve --user to accountID
  let accountID: string | undefined;
  if (args.user) {
    const accounts = await client.getAccounts();
    const match = accounts.find((a) => a.name?.toLowerCase() === args.user!.toLowerCase());
    if (!match) {
      console.error(`\n❌ User "${args.user}" not found.`);
      console.error("   Available accounts:");
      accounts.forEach((a) => console.error(`     ${a.name} (ID: ${a.id})`));
      process.exit(1);
    }
    accountID = match.id;
    console.log(`   User: ${match.name} (ID: ${accountID})`);
  }

  // Resolve target sections
  const allSections = await client.getSections();

  let targetSections;
  if (args.section) {
    const match = allSections.find(
      (s) => s.key === args.section || s.title.toLowerCase() === args.section!.toLowerCase(),
    );
    if (!match) {
      console.error(`\n❌ Section "${args.section}" not found.`);
      console.error("   Available sections:");
      allSections.forEach((s) => console.error(`     [${s.key}] ${s.title} (${s.type})`));
      process.exit(1);
    }
    targetSections = [match];
  } else {
    targetSections = allSections;
  }

  console.log(`   Sections: ${targetSections.map((s) => s.title).join(", ")}`);

  for (const section of targetSections) {
    const sectionId = section.key;

    console.log(`\n📚 "${section.title}" — starting...`);

    // Fetch per-section watch history
    console.log(`   📜 Fetching watch history...`);
    const history = await client.getWatchHistory({
      accountID,
      librarySectionID: sectionId,
      limit: LIMIT * 5,
    });

    if (history.length === 0) {
      console.log(`   ⏭  No watch history found, skipping.`);
      continue;
    }

    // Deduplicate: for TV episodes group by show (grandparentTitle)
    const seen = new Set<string>();
    const watchedItems = [];
    for (const item of history) {
      const key =
        item.type === "episode"
          ? `show:${item.grandparentRatingKey || item.grandparentTitle}`
          : `${item.type}:${item.ratingKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      watchedItems.push(item);
      if (watchedItems.length >= LIMIT) break;
    }

    console.log(`   📜 Found ${watchedItems.length} unique recently watched item(s):`);
    for (const item of watchedItems) {
      const title =
        item.type === "episode" ? item.grandparentTitle : `${item.title}${item.year ? ` (${item.year})` : ""}`;
      console.log(`     • ${title}`);
    }

    // Delete old byw collections
    console.log(`   🗑  Deleting previous "because you watched" collections...`);
    const deleted = await client.deleteCollectionsByLabel(sectionId, BYW_LABEL);
    console.log(`   🗑  Deleted ${deleted} old collection(s).`);

    // Fetch all items in section
    console.log(`   📥 Fetching library items...`);
    const libraryItems = await client.fetchAllItems(sectionId);
    console.log(`   📥 Found ${libraryItems.length} item(s).`);

    if (libraryItems.length < 15) {
      console.log(`   ⏭  Too few items to generate collections, skipping.`);
      continue;
    }

    // Build watched item titles for the prompt
    const watchedTitles = watchedItems.map((item) =>
      item.type === "episode" ? item.grandparentTitle! : `${item.title}${item.year ? ` (${item.year})` : ""}`,
    );

    // Ask AI for collections
    console.log(`   🤖 Asking Claude for "Because you watched" collections...`);
    const aiCollections = await generateBYWCollections(
      ANTHROPIC_API_KEY,
      client,
      watchedTitles,
      libraryItems,
      section.title,
    );
    console.log(`   🤖 Got ${aiCollections.length} collection(s) from AI.`);

    // Build title→ratingKey lookup
    const titleMap = new Map<string, string>();
    for (const item of libraryItems) {
      const key = `${item.title}${item.year ? ` (${item.year})` : ""}`;
      titleMap.set(key, item.ratingKey);
      titleMap.set(item.title, item.ratingKey);
    }

    // Create collections and pin them
    let created = 0;
    for (const col of aiCollections) {
      const ratingKeys = col.items.map((title) => titleMap.get(title)).filter(Boolean) as string[];

      if (ratingKeys.length < 10) {
        client.log(`Skipping "${col.name}" — only ${ratingKeys.length} matching item(s), need at least 10`);
        continue;
      }

      console.log(`   📦 Creating "${col.name}" (${ratingKeys.length} items)...`);

      const collectionKey = await client.createCollectionWithLabel(
        sectionId,
        section.type,
        machineId,
        col.name,
        ratingKeys,
        BYW_LABEL,
      );

      if (collectionKey) {
        const pinned = await client.pinToHomepage(sectionId, collectionKey, {
          promotedToOwnHome: 1,
          promotedToRecommendedHome: 1,
          promotedToSharedHome: 0,
        });
        if (pinned) {
          client.log(`Pinned "${col.name}" to homepage`);
        } else {
          client.log(`Created "${col.name}" but could not pin to homepage`);
        }
        created++;
      }
    }

    console.log(`   ✅ Created and pinned ${created} collection(s) for "${section.title}".`);
  }

  console.log("\n🎉 All done!");
}

async function generateBYWCollections(
  apiKey: string,
  client: PlexClient,
  watchedTitles: string[],
  libraryItems: PlexItem[],
  sectionTitle: string,
): Promise<AiCollection[]> {
  const anthropic = new Anthropic({ apiKey });

  const itemList = libraryItems.map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`).join("\n");

  const watchedList = watchedTitles.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 4096,
    temperature: 1,
    messages: [
      {
        role: "user",
        content: `You are a movie/TV curator. Given a user's recently watched items and their full Plex "${sectionTitle}" library, create "Because you watched" collections.

Recently watched items:
${watchedList}

Rules:
- Create exactly one collection per watched item, named "Because you watched [Title]"
- Each collection MUST have between 15 and 30 items
- Only use titles that exactly match the library list below
- Do NOT include the watched item itself in its collection
- Pick items that are thematically similar: shared vibes, tonal similarities, narrative parallels, genre connections, visual motifs
- Each collection should feel like a genuine recommendation, not just the same genre

Return ONLY valid minified JSON on a single line, no markdown fences, no explanation, no newlines within the JSON. Format:
[{"name":"Because you watched Title","items":["Title (Year)","Title (Year)"]}]

Here is the full library:
${itemList}`,
      },
    ],
  });

  const text = (response.content[0] as { type: "text"; text: string }).text.trim();
  client.log("AI response:", text);
  return parseJSON(text);
}

function parseJSON(text: string): AiCollection[] {
  try {
    return JSON.parse(text);
  } catch {}

  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}

    const cleaned = match[0].replace(/,\s*([}\]])/g, "$1").replace(/[\x00-\x1f]/g, " ");
    try {
      return JSON.parse(cleaned);
    } catch {}
  }

  throw new Error(`Failed to parse AI response as JSON:\n${text}`);
}
