import Anthropic from "@anthropic-ai/sdk";
import { createPlexClient, type PlexItem } from "../plex.ts";
import { getConfig } from "../config.ts";
import type { JobContext, BywJobConfig } from "../job-context.ts";

const BYW_LABEL = "BecauseYouWatched";
const BYW_LABELS = ["Tinkerbell", BYW_LABEL];

interface AiCollection {
  name: string;
  items: string[];
}

export default async function run(ctx: JobContext, config: BywJobConfig): Promise<void> {
  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  const ANTHROPIC_API_KEY = getConfig("global_anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
  const LIMIT = Math.min(config.limit ?? 10, 20);

  if (!PLEX_TOKEN) {
    throw new Error("Plex token is required. Configure it in Settings.");
  }

  if (!ANTHROPIC_API_KEY) {
    throw new Error("Anthropic API key is required. Configure it in Settings.");
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    signal: ctx.signal,
  });

  ctx.log(`tinkerbell because-you-watched`);
  ctx.log(`Server: ${PLEX_URL}`);

  const identity = await client.getIdentity();
  const machineId = identity.machineIdentifier;
  ctx.log(`Server name: ${identity.friendlyName}`);

  // Always run for all accounts
  const accounts = await client.getAccounts();
  const sharings = await client.getSharings(machineId);
  const idToPlexUsername = new Map<string, string>();
  for (const s of sharings) {
    idToPlexUsername.set(String(s.userId), s.username);
  }

  const resolvedUsers: Array<{ name: string; plexUsername: string; accountID: string | undefined }> = [];

  for (const account of accounts) {
    if (account.name) {
      const plexUsername = idToPlexUsername.get(account.id) || account.name;
      resolvedUsers.push({ name: account.name, plexUsername, accountID: account.id });
    }
  }
  if (resolvedUsers.length === 0) {
    throw new Error("No user accounts found.");
  }
  ctx.log(`Users: ${resolvedUsers.map((u) => u.name).join(", ")}`);

  // Resolve target sections
  let allSections = await client.getSections();

  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
  }

  let targetSections;
  if (config.sections && config.sections.length > 0) {
    const names = config.sections.map((s) => s.trim().toLowerCase());
    targetSections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
    if (targetSections.length === 0) {
      throw new Error(`No matching sections found for "${config.sections.join(", ")}".`);
    }
  } else {
    targetSections = allSections;
  }

  ctx.log(`Sections: ${targetSections.map((s) => s.title).join(", ")}`);

  const totalSteps = targetSections.length * resolvedUsers.length;
  let step = 0;

  for (const user of resolvedUsers) {
    const isPerUser = !!user.name;
    if (isPerUser) {
      ctx.log(`Processing user: ${user.name}`);
    }

    const collectionLabels = isPerUser ? ["Tinkerbell", BYW_LABEL, `User:${user.plexUsername}`] : BYW_LABELS;

    for (const section of targetSections) {
      step++;
      ctx.progress(step, totalSteps, `Processing "${section.title}"${isPerUser ? ` for ${user.name}` : ""}...`);
      const sectionId = section.key;

      ctx.log(`"${section.title}"${isPerUser ? ` (${user.name})` : ""} — starting...`);

      ctx.log(`Fetching watch history...`);
      const history = await client.getWatchHistory({
        accountID: user.accountID,
        librarySectionID: sectionId,
        limit: LIMIT * 5,
      });

      if (history.length === 0) {
        ctx.log(`No watch history found, skipping.`);
        continue;
      }

      // Deduplicate
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

      ctx.log(`Found ${watchedItems.length} unique recently watched item(s).`);

      // Fetch all items in section
      ctx.log(`Fetching library items...`);
      const libraryItems = await client.fetchAllItems(sectionId);
      ctx.log(`Found ${libraryItems.length} item(s).`);

      if (libraryItems.length < 15) {
        ctx.log(`Too few items to generate collections, skipping.`);
        continue;
      }

      const watchedTitles = watchedItems.map((item) =>
        item.type === "episode" ? item.grandparentTitle! : `${item.title}${item.year ? ` (${item.year})` : ""}`,
      );

      ctx.log(`Asking Claude for "Because you watched" collections...`);
      const aiCollections = await generateBYWCollections(
        ANTHROPIC_API_KEY,
        ctx,
        watchedTitles,
        libraryItems,
        section.title,
      );
      ctx.log(`Got ${aiCollections.length} collection(s) from AI.`);

      const titleMap = new Map<string, string>();
      for (const item of libraryItems) {
        const key = `${item.title}${item.year ? ` (${item.year})` : ""}`;
        titleMap.set(key, item.ratingKey);
        titleMap.set(item.title, item.ratingKey);
      }

      const newCollectionNames = new Set<string>();
      for (const col of aiCollections) {
        const ratingKeys = col.items.map((title) => titleMap.get(title)).filter(Boolean) as string[];
        if (ratingKeys.length >= 10) {
          newCollectionNames.add(col.name.toLowerCase());
        }
      }

      ctx.log(`Cleaning up old "because you watched" collections...`);
      const allCollections = await client.getCollections(sectionId);
      let deleted = 0;
      for (const col of allCollections) {
        const labels = await client.getCollectionLabels(col.ratingKey);
        const hasByw = labels.some((l) => l.tag.toLowerCase() === BYW_LABEL.toLowerCase());
        if (!hasByw) continue;

        if (isPerUser) {
          const hasUserLabel = labels.some((l) => l.tag === `User:${user.plexUsername}`);
          if (!hasUserLabel) continue;
        }

        if (newCollectionNames.has(col.title.toLowerCase())) {
          ctx.log(`Keeping "${col.title}" (still relevant)`);
          continue;
        }
        ctx.log(`Deleting collection "${col.title}" (${col.ratingKey})`);
        await client.deleteItem(col.ratingKey);
        deleted++;
      }
      ctx.log(`Deleted ${deleted} old collection(s).`);

      let created = 0;
      for (const col of aiCollections) {
        const ratingKeys = col.items.map((title) => titleMap.get(title)).filter(Boolean) as string[];

        if (ratingKeys.length < 10) {
          ctx.log(`Skipping "${col.name}" — only ${ratingKeys.length} matching item(s), need at least 10`);
          continue;
        }

        const existingCol = allCollections.find((c) => c.title.toLowerCase() === col.name.toLowerCase());
        if (existingCol) {
          ctx.log(`"${col.name}" already exists, skipping creation.`);
          created++;
          continue;
        }

        ctx.log(`Creating "${col.name}" (${ratingKeys.length} items)...`);

        const collectionKey = await client.createCollectionWithLabel(
          sectionId,
          section.type,
          machineId,
          col.name,
          ratingKeys,
          collectionLabels,
        );

        if (collectionKey) {
          await client.pinToHomepage(sectionId, collectionKey, {
            promotedToOwnHome: 1,
            promotedToRecommendedHome: 1,
            promotedToSharedHome: 0,
          });
          ctx.log(`Pinned "${col.name}" to homepage`);
          created++;
        }
      }

      ctx.log(`${created} collection(s) for "${section.title}"${isPerUser ? ` (${user.name})` : ""} (new + kept).`);
    }
  }

  ctx.log("All done!");
}

async function generateBYWCollections(
  apiKey: string,
  ctx: JobContext,
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
  ctx.log("AI response:", text);
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
