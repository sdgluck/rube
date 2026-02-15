import Anthropic from "@anthropic-ai/sdk";
import { createPlexClient, type PlexItem, type PlexSection } from "../plex.ts";
import { getConfig } from "../config.ts";
import type { JobContext, GenerateJobConfig } from "../../shared/job-context.ts";

interface AiCollection {
  name: string;
  items: string[];
}

export default async function run(ctx: JobContext, config: GenerateJobConfig): Promise<void> {
  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  const ANTHROPIC_API_KEY = getConfig("global_anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
  const MAX_COLLECTIONS = config.limit ?? 8;

  if (MAX_COLLECTIONS > 10) {
    throw new Error("Limit cannot exceed 10.");
  }

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

  async function generateCollections(
    items: PlexItem[],
    sectionTitle: string,
    maxCollections: number,
  ): Promise<AiCollection[]> {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const itemList = shuffled.map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`).join("\n");

    const seed = Math.floor(Math.random() * 1_000_000);

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      temperature: 1,
      messages: [
        {
          role: "user",
          content: `You are a movie/TV curator. Given this list of items from a Plex "${sectionTitle}" library, create curated themed collections.

Rules:
- Create exactly ${maxCollections} collections
- Each collection MUST have between 15 and 30 items, no fewer than 15
- Each item can appear in multiple collections
- Only use titles that exactly match the input list
- Collection names should be creative, fun, relatively short, not academic, and NEVER use colons (no "Title: Subtitle" format)
- Be surprising and inventive with your themes — avoid obvious genres or decades groupings
- Think of unexpected connections between items: tonal similarities, visual motifs, narrative parallels, thematic undercurrents, shared vibes

Random seed for variety: ${seed}

Return ONLY valid minified JSON on a single line, no markdown fences, no explanation, no newlines within the JSON. Format:
[{"name":"Collection Name","items":["Title (Year)","Title (Year)"]}]

Here are the items:
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

  async function processSection(section: PlexSection, machineId: string): Promise<void> {
    const sectionId = section.key;
    const sectionTitle = section.title;

    ctx.log(`"${sectionTitle}" — starting...`);

    ctx.log(`Deleting previous tinkerbell collections...`);
    const deleted = await client.deleteCollectionsByLabel(sectionId, "Generated");
    ctx.log(`Deleted ${deleted} old collection(s).`);

    ctx.log(`Fetching library items...`);
    const items = await client.fetchAllItems(sectionId);
    ctx.log(`Found ${items.length} item(s).`);

    if (items.length < 10) {
      ctx.log(`Too few items to generate collections, skipping.`);
      return;
    }

    ctx.log(`Asking Claude for curated collections...`);
    const aiCollections = await generateCollections(items, sectionTitle, MAX_COLLECTIONS);
    ctx.log(`Got ${aiCollections.length} collection(s) from AI.`);

    const titleMap = new Map<string, string>();
    for (const item of items) {
      const key = `${item.title}${item.year ? ` (${item.year})` : ""}`;
      titleMap.set(key, item.ratingKey);
      titleMap.set(item.title, item.ratingKey);
    }

    let created = 0;
    for (const col of aiCollections) {
      const ratingKeys = col.items.map((title) => titleMap.get(title)).filter(Boolean) as string[];

      if (ratingKeys.length < 15) {
        ctx.log(`Skipping "${col.name}" — only ${ratingKeys.length} matching item(s), need at least 15`);
        continue;
      }

      ctx.log(`Creating "${col.name}" (${ratingKeys.length} items)...`);

      const collectionKey = await client.createCollectionWithLabel(
        sectionId,
        section.type,
        machineId,
        col.name,
        ratingKeys,
        ["Tinkerbell", "Generated"],
      );

      if (collectionKey) {
        await client.pinToHomepage(sectionId, collectionKey, {
          promotedToOwnHome: 1,
          promotedToRecommendedHome: 1,
          promotedToSharedHome: 1,
        });
        ctx.log(`Pinned "${col.name}" to homepage`);
        created++;
      }
    }

    ctx.log(`Created and pinned ${created} collection(s) for "${sectionTitle}".`);
  }

  ctx.log(`tinkerbell generate`);
  ctx.log(`Server: ${PLEX_URL}`);

  const identity = await client.getIdentity();
  const machineId = identity.machineIdentifier;
  ctx.log(`Server name: ${identity.friendlyName}`);

  let allSections = await client.getSections();

  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
  }

  let sections;
  if (config.sections && config.sections.length > 0) {
    const names = config.sections.map((s) => s.trim().toLowerCase());
    sections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
    if (sections.length === 0) {
      throw new Error(`No matching sections found for "${config.sections.join(", ")}".`);
    }
  } else {
    sections = allSections;
  }

  ctx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);

  for (const section of sections) {
    ctx.progress(sections.indexOf(section) + 1, sections.length, `Processing "${section.title}"...`);
    await processSection(section, machineId);
  }

  ctx.log("All done!");
}
