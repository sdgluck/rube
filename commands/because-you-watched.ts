import Anthropic from "@anthropic-ai/sdk";
import { createPlexClient, type PlexClient, type PlexItem } from "../plex.ts";
import { getConfig } from "../config.ts";

const BYW_LABEL = "BecauseYouWatched";
const BYW_LABELS = ["Tinkerbell", BYW_LABEL];

interface BywArgs {
  url?: string;
  token?: string;
  user?: string;
  sections?: string;
  limit?: string;
  verbose?: boolean;
}

interface AiCollection {
  name: string;
  items: string[];
}

export default async function run(args: BywArgs): Promise<void> {
  const PLEX_URL = (
    args.url ||
    getConfig("global_plex_url") ||
    process.env.PLEX_URL ||
    "http://localhost:32400"
  ).replace(/\/+$/, "");
  const PLEX_TOKEN = args.token || getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  const ANTHROPIC_API_KEY = getConfig("global_anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
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

  // Resolve target users
  const accounts = await client.getAccounts();
  // Build map of account ID → plex.tv username (for label matching with sharing restrictions)
  const sharings = await client.getSharings(machineId);
  const idToPlexUsername = new Map<string, string>();
  for (const s of sharings) {
    idToPlexUsername.set(String(s.userId), s.username);
  }

  const resolvedUsers: Array<{ name: string; plexUsername: string; accountID: string | undefined }> = [];

  if (args.user) {
    // CLI --user flag: single user
    const match = accounts.find((a) => a.name?.toLowerCase() === args.user!.toLowerCase());
    if (!match) {
      console.error(`\n❌ User "${args.user}" not found.`);
      console.error("   Available accounts:");
      accounts.forEach((a) => console.error(`     ${a.name} (ID: ${a.id})`));
      process.exit(1);
    }
    const plexUsername = idToPlexUsername.get(match.id) || match.name || args.user;
    resolvedUsers.push({ name: match.name || args.user, plexUsername, accountID: match.id });
    console.log(`   User: ${match.name} (ID: ${match.id}, plex.tv: ${plexUsername})`);
  } else {
    // No --user flag: run for all accounts
    for (const account of accounts) {
      if (account.name) {
        const plexUsername = idToPlexUsername.get(account.id) || account.name;
        resolvedUsers.push({ name: account.name, plexUsername, accountID: account.id });
      }
    }
    if (resolvedUsers.length === 0) {
      console.error(`\n❌ No user accounts found.`);
      process.exit(1);
    }
    console.log(`   Users: ${resolvedUsers.map((u) => u.name).join(", ")}`);
  }

  // Resolve target sections
  let allSections = await client.getSections();

  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
  }

  let targetSections;
  if (args.sections) {
    const names = args.sections.split(",").map((s) => s.trim().toLowerCase());
    targetSections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
    if (targetSections.length === 0) {
      console.error(`\n❌ No matching sections found for "${args.sections}".`);
      console.error("   Available sections:");
      allSections.forEach((s) => console.error(`     [${s.key}] ${s.title} (${s.type})`));
      process.exit(1);
    }
  } else {
    targetSections = allSections;
  }

  console.log(`   Sections: ${targetSections.map((s) => s.title).join(", ")}`);

  const totalSteps = targetSections.length * resolvedUsers.length;
  let step = 0;

  for (const user of resolvedUsers) {
    const isPerUser = !!user.name;
    if (isPerUser) {
      console.log(`\n👤 Processing user: ${user.name}`);
    }

    // Labels for this user's collections — use plex.tv username for sharing restriction compatibility
    const collectionLabels = isPerUser ? ["Tinkerbell", BYW_LABEL, `User:${user.plexUsername}`] : BYW_LABELS;

    for (const section of targetSections) {
      step++;
      console.log(
        `§PROGRESS:${step}/${totalSteps}:Processing "${section.title}"${isPerUser ? ` for ${user.name}` : ""}...`,
      );
      const sectionId = section.key;

      console.log(`\n📚 "${section.title}"${isPerUser ? ` (${user.name})` : ""} — starting...`);

      // Fetch per-section watch history
      console.log(`   📜 Fetching watch history...`);
      const history = await client.getWatchHistory({
        accountID: user.accountID,
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

      // Determine which new collections will actually be created
      const newCollectionNames = new Set<string>();
      for (const col of aiCollections) {
        const ratingKeys = col.items.map((title) => titleMap.get(title)).filter(Boolean) as string[];
        if (ratingKeys.length >= 10) {
          newCollectionNames.add(col.name.toLowerCase());
        }
      }

      // Delete old byw collections that are NOT in the new list
      // When per-user, only delete collections that have this user's label
      console.log(`   🗑  Cleaning up old "because you watched" collections...`);
      const allCollections = await client.getCollections(sectionId);
      let deleted = 0;
      for (const col of allCollections) {
        const labels = await client.getCollectionLabels(col.ratingKey);
        const hasByw = labels.some((l) => l.tag.toLowerCase() === BYW_LABEL.toLowerCase());
        if (!hasByw) continue;

        // When per-user, only touch collections with this user's label
        if (isPerUser) {
          const hasUserLabel = labels.some((l) => l.tag === `User:${user.plexUsername}`);
          if (!hasUserLabel) continue;
        }

        if (newCollectionNames.has(col.title.toLowerCase())) {
          console.log(`   ♻️  Keeping "${col.title}" (still relevant)`);
          continue;
        }
        client.log(`Deleting collection "${col.title}" (${col.ratingKey})`);
        await client.deleteItem(col.ratingKey);
        deleted++;
      }
      console.log(
        `   🗑  Deleted ${deleted} old collection(s), kept ${newCollectionNames.size - deleted >= 0 ? allCollections.length - deleted : 0} existing.`,
      );

      // Create collections and pin them (skip if already exists)
      let created = 0;
      for (const col of aiCollections) {
        const ratingKeys = col.items.map((title) => titleMap.get(title)).filter(Boolean) as string[];

        if (ratingKeys.length < 10) {
          client.log(`Skipping "${col.name}" — only ${ratingKeys.length} matching item(s), need at least 10`);
          continue;
        }

        // Skip if a collection with this name already exists (was kept)
        const existingCol = allCollections.find((c) => c.title.toLowerCase() === col.name.toLowerCase());
        if (existingCol) {
          console.log(`   ♻️  "${col.name}" already exists, skipping creation.`);
          created++;
          continue;
        }

        console.log(`   📦 Creating "${col.name}" (${ratingKeys.length} items)...`);

        const collectionKey = await client.createCollectionWithLabel(
          sectionId,
          section.type,
          machineId,
          col.name,
          ratingKeys,
          collectionLabels,
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

      console.log(
        `   ✅ ${created} collection(s) for "${section.title}"${isPerUser ? ` (${user.name})` : ""} (new + kept).`,
      );
    }
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
