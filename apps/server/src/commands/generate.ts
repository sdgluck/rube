import Anthropic from "@anthropic-ai/sdk";
import { errorMessage } from "../lib/util.ts";
import PQueue from "p-queue";
import { z } from "zod";
import { createPlexClient, type PlexClient, type PlexSection } from "@tinkerbell/plex";
import { getConfig } from "../lib/config.ts";
import { plexHealthCallback, getOmdbClient, getImdbClient } from "../lib/clients.ts";
import { upsertCollectionByKey } from "../domains/collections.ts";
import { getEnabledRules, getRule, setRuleLastCollection, type Rule } from "../domains/rules.ts";
import { appendHistory, getRecentHistory, type HistoricalCollection } from "../domains/rule-history.ts";
import { extractImdbId } from "@tinkerbell/omdb";
import { reportHealth } from "../domains/health.ts";
import type { JobContext, GenerateJobConfig } from "../lib/job-context.ts";

interface AiCollection {
  name: string;
  items: string[];
}

const ruleConfigSchema = z.object({
  prompt: z.string().optional(),
  themes: z.array(z.string()).optional(),
  customThemes: z.array(z.string()).optional(),
  vibe: z.enum(["playful", "serious", "mixed"]).optional(),
  nameStyle: z.enum(["short_punchy", "descriptive"]).optional(),
  limit: z.number().optional(),
  minItems: z.number().optional(),
  sections: z.array(z.string()).optional(),
  chart: z.string().optional(),
  listId: z.string().optional(),
  filter: z.string().optional(),
});
type RuleConfig = z.infer<typeof ruleConfigSchema>;

const VIBE_HINTS: Record<NonNullable<RuleConfig["vibe"]>, string> = {
  playful: "Playful, witty, irreverent — names can be cheeky.",
  serious: "Serious and considered — names should feel curated and adult.",
  mixed: "Mix playful and serious tones across the set.",
};

const NAME_STYLE_HINTS: Record<NonNullable<RuleConfig["nameStyle"]>, string> = {
  short_punchy: "Names should be short and punchy (1–4 words).",
  descriptive: "Names can be a bit longer and descriptive (up to ~6 words).",
};

function buildAiPrompt(args: {
  sectionTitle: string;
  limit: number;
  minItems: number;
  themes: string[];
  customThemes: string[];
  vibe?: RuleConfig["vibe"];
  nameStyle?: RuleConfig["nameStyle"];
  history: HistoricalCollection[];
}): string {
  const { sectionTitle, limit, minItems, themes, customThemes, vibe, nameStyle, history } = args;

  const allThemes = [...themes, ...customThemes].filter((t) => t.trim().length > 0);
  const themesBlock =
    allThemes.length > 0
      ? `Lean into these angles when forming collections: ${allThemes.map((t) => `"${t}"`).join(", ")}.`
      : `Use any inventive angle: tonal similarities, visual motifs, narrative parallels, thematic undercurrents, shared vibes.`;

  const vibeLine = vibe ? VIBE_HINTS[vibe] : "";
  const nameLine = nameStyle ? NAME_STYLE_HINTS[nameStyle] : "";

  const historyBlock =
    history.length === 0
      ? "(no prior collections — full creative freedom)"
      : history
          .map((c) => {
            const sample = c.sampleItems.slice(0, 5).join(", ");
            return `- "${c.name}"${sample ? ` — e.g. ${sample}` : ""}`;
          })
          .join("\n");

  return `You are a movie/TV curator. Given a list of items from a Plex "${sectionTitle}" library, create curated themed collections.

Rules:
- Create exactly ${limit} collections.
- Each collection MUST have between ${minItems} and 30 items, no fewer than ${minItems}.
- Each item can appear in multiple collections.
- Only use titles that exactly match the input list.
- Collection names must be creative, fun, relatively short, not academic, and NEVER use colons (no "Title: Subtitle" format).
- Be surprising and inventive — avoid obvious genre or decade groupings.
${vibeLine ? `- ${vibeLine}\n` : ""}${nameLine ? `- ${nameLine}\n` : ""}
${themesBlock}

Previously generated collections for this library (DO NOT repeat these themes, names, or produce collections whose roster would substantially overlap with these):
${historyBlock}

Your new collections must explore different angles than anything above.

Return ONLY valid minified JSON on a single line, no markdown fences, no explanation, no newlines within the JSON. Format:
[{"name":"Collection Name","items":["Title (Year)","Title (Year)"]}]`;
}

function pickSampleItems(titles: string[], n = 5): string[] {
  if (titles.length <= n) return [...titles];
  const copy = [...titles];
  const out: string[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

async function fetchImdbChartNormalized(id: string): Promise<{ name: string; imdbIds: string[] }> {
  return getImdbClient().fetchChart(id);
}

async function fetchImdbListNormalized(id: string): Promise<{ name: string; imdbIds: string[] }> {
  const result = await getImdbClient().fetchList(id);
  return { name: result.title, imdbIds: result.imdbIds };
}

function parseRuleConfig(rule: Rule): RuleConfig {
  const parsed = ruleConfigSchema.safeParse(rule.config ?? {});
  if (!parsed.success) {
    console.warn(`[generate] rule "${rule.name}" has invalid config:`, parsed.error.message);
    return {};
  }
  return parsed.data;
}

function parseJSON(ctx: JobContext, text: string): AiCollection[] {
  try {
    return JSON.parse(text);
  } catch {}

  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}

    // eslint-disable-next-line no-control-regex
    const cleaned = match[0].replace(/,\s*([}\]])/g, "$1").replace(/[\u0000-\u001f]/g, " ");
    try {
      return JSON.parse(cleaned);
    } catch {}
  }

  throw new Error(`Failed to parse AI response as JSON:\n${text}`);
}

async function handleAiPrompt(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  machineId: string,
  rule: Rule,
  ruleConfig: RuleConfig,
  labels: string[],
): Promise<string | null> {
  let lastCollectionKey: string | null = null;
  const ANTHROPIC_API_KEY = getConfig("global_anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    throw new Error("Anthropic API key is required for AI prompt rules. Configure it in Settings.");
  }

  const maxCollections = ruleConfig.limit ?? 8;
  const minItems = ruleConfig.minItems ?? 15;
  const themes = ruleConfig.themes ?? [];
  const customThemes = ruleConfig.customThemes ?? [];

  if (maxCollections > 10) {
    throw new Error("Limit cannot exceed 10.");
  }

  for (const section of sections) {
    const sectionId = section.key;
    const sectionTitle = section.title;

    ctx.log(`[AI Prompt] "${sectionTitle}" — starting...`);

    ctx.log(`Fetching library items...`);
    const items = await client.fetchAllItems(sectionId);
    ctx.log(`Found ${items.length} item(s).`);

    if (items.length < 10) {
      ctx.log(`Too few items to generate collections, skipping.`);
      continue;
    }

    const history = getRecentHistory(rule.id, sectionId);
    if (history.length > 0) {
      ctx.log(`Loaded ${history.length} prior collection(s) from history to inform prompt.`);
    }

    const prompt = buildAiPrompt({
      sectionTitle,
      limit: maxCollections,
      minItems,
      themes,
      customThemes,
      vibe: ruleConfig.vibe,
      nameStyle: ruleConfig.nameStyle,
      history,
    });

    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const itemList = shuffled.map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`).join("\n");

    const seed = Math.floor(Math.random() * 1_000_000);

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    ctx.log(`Asking Claude for curated collections...`);
    let response;
    try {
      response = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        temperature: 1,
        messages: [
          {
            role: "user",
            content: `${prompt}

Random seed for variety: ${seed}

Here are the items:
${itemList}`,
          },
        ],
      });
      reportHealth(
        "Claude AI",
        "ok",
        `${response.model} — ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`,
      );
    } catch (err) {
      reportHealth("Claude AI", "error", errorMessage(err));
      throw err;
    }

    const text = (response.content[0] as { type: "text"; text: string }).text.trim();
    ctx.log("AI response:", text);
    const aiCollections = parseJSON(ctx, text);
    ctx.log(`Got ${aiCollections.length} collection(s) from AI.`);

    const titleMap = new Map<string, string>();
    for (const item of items) {
      const key = `${item.title}${item.year ? ` (${item.year})` : ""}`;
      titleMap.set(key, item.ratingKey);
      titleMap.set(item.title, item.ratingKey);
    }

    let created = 0;
    const createdForHistory: HistoricalCollection[] = [];
    for (const col of aiCollections) {
      const matchedTitles = col.items.filter((title) => titleMap.has(title));
      const ratingKeys = matchedTitles.map((title) => titleMap.get(title)!) as string[];

      if (ratingKeys.length < minItems) {
        ctx.log(`Skipping "${col.name}" — only ${ratingKeys.length} matching item(s), need at least ${minItems}`);
        continue;
      }

      ctx.log(`Creating "${col.name}" (${ratingKeys.length} items)...`);

      const collectionKey = await client.createCollectionWithLabel(
        sectionId,
        section.type,
        machineId,
        col.name,
        ratingKeys,
        labels,
      );

      if (collectionKey) {
        await client.pinToHomepage(sectionId, collectionKey, {
          promotedToOwnHome: 1,
          promotedToRecommendedHome: 1,
          promotedToSharedHome: 1,
        });
        ctx.log(`Pinned "${col.name}" to homepage`);
        await upsertCollectionByKey(client, section, collectionKey);
        lastCollectionKey = collectionKey;
        created++;
        createdForHistory.push({ name: col.name, sampleItems: pickSampleItems(matchedTitles) });
      }
    }

    if (createdForHistory.length > 0) {
      appendHistory(rule.id, sectionId, sectionTitle, createdForHistory);
      ctx.log(`Recorded ${createdForHistory.length} collection(s) in rule history.`);
    }

    ctx.log(`Created and pinned ${created} collection(s) for "${sectionTitle}".`);
  }

  return lastCollectionKey;
}

async function handleRated(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  machineId: string,
  sort: string,
  ruleConfig: RuleConfig,
  labels: string[],
  displayName: string,
): Promise<string | null> {
  let lastCollectionKey: string | null = null;
  const limit = ruleConfig.limit ?? 50;

  for (const section of sections) {
    ctx.log(`[${displayName}] "${section.title}" — fetching top ${limit} items sorted by ${sort}...`);

    const items = await client.fetchItemsSorted(section.key, sort, limit);
    if (items.length === 0) {
      ctx.log(`No items found, skipping.`);
      continue;
    }

    const ratingKeys = items.map((i) => i.ratingKey);
    const collectionName = `${displayName} in ${section.title}`;

    ctx.log(`Creating "${collectionName}" (${ratingKeys.length} items)...`);

    const collectionKey = await client.createCollectionWithLabel(
      section.key,
      section.type,
      machineId,
      collectionName,
      ratingKeys,
      labels,
    );

    if (collectionKey) {
      await client.pinToHomepage(section.key, collectionKey, {
        promotedToOwnHome: 1,
        promotedToRecommendedHome: 1,
        promotedToSharedHome: 1,
      });
      ctx.log(`Pinned "${collectionName}" to homepage`);
      await upsertCollectionByKey(client, section, collectionKey);
      lastCollectionKey = collectionKey;
    }
  }

  return lastCollectionKey;
}

async function handleGrouped(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  machineId: string,
  field: string,
  ruleConfig: RuleConfig,
  labels: string[],
): Promise<string | null> {
  let lastCollectionKey: string | null = null;
  const maxCollections = ruleConfig.limit ?? 10;

  for (const section of sections) {
    ctx.log(`[${field}] "${section.title}" — fetching top ${maxCollections} ${field}s...`);

    const entries = await client.fetchGroupedByField(section.key, field, maxCollections);
    if (entries.length === 0) {
      ctx.log(`No ${field} entries found, skipping.`);
      continue;
    }

    let created = 0;
    for (const entry of entries) {
      const items = await client.fetchItemsByFilter(entry.key);
      if (items.length < 3) {
        ctx.log(`Skipping "${entry.tag}" — only ${items.length} item(s), need at least 3`);
        continue;
      }

      const ratingKeys = items.map((i) => i.ratingKey);
      const collectionName = entry.tag;

      ctx.log(`Creating "${collectionName}" (${ratingKeys.length} items)...`);

      const collectionKey = await client.createCollectionWithLabel(
        section.key,
        section.type,
        machineId,
        collectionName,
        ratingKeys,
        labels,
      );

      if (collectionKey) {
        await client.pinToHomepage(section.key, collectionKey, {
          promotedToOwnHome: 1,
          promotedToRecommendedHome: 1,
          promotedToSharedHome: 1,
        });
        ctx.log(`Pinned "${collectionName}" to homepage`);
        await upsertCollectionByKey(client, section, collectionKey);
        lastCollectionKey = collectionKey;
        created++;
      }
    }

    ctx.log(`Created ${created} ${field} collection(s) for "${section.title}".`);
  }

  return lastCollectionKey;
}

async function handleImdbContent(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  machineId: string,
  ruleConfig: RuleConfig,
  labels: string[],
  fetchContent: (id: string) => Promise<{ name: string; imdbIds: string[] }>,
  contentId: string,
  contentType: string,
): Promise<string | null> {
  let lastCollectionKey: string | null = null;
  if (!contentId) throw new Error(`IMDb ${contentType} ID is required.`);

  ctx.log(`Fetching IMDb ${contentType} "${contentId}"...`);
  const { name: contentName, imdbIds } = await fetchContent(contentId);
  ctx.log(`Found ${imdbIds.length} title(s) in "${contentName}".`);

  for (const section of sections) {
    ctx.log(`[${contentName}] "${section.title}" — matching against library...`);
    const items = await client.allItemsWithGuids(section.key);

    const imdbToRatingKey = new Map<string, string>();
    for (const item of items) {
      for (const guid of item.guids) {
        const match = guid.match(/imdb:\/\/(tt\d+)/);
        if (match) {
          imdbToRatingKey.set(match[1], item.ratingKey);
          break;
        }
      }
    }

    const ratingKeys = imdbIds.map((id) => imdbToRatingKey.get(id)).filter(Boolean) as string[];

    if (ratingKeys.length === 0) {
      ctx.log(`No matching items found in "${section.title}", skipping.`);
      continue;
    }

    ctx.log(`Creating "${contentName}" (${ratingKeys.length} items)...`);
    const collectionKey = await client.createCollectionWithLabel(
      section.key,
      section.type,
      machineId,
      contentName,
      ratingKeys,
      labels,
    );

    if (collectionKey) {
      await client.pinToHomepage(section.key, collectionKey, {
        promotedToOwnHome: 1,
        promotedToRecommendedHome: 1,
        promotedToSharedHome: 1,
      });
      ctx.log(`Pinned "${contentName}" to homepage`);
      await upsertCollectionByKey(client, section, collectionKey);
      lastCollectionKey = collectionKey;
    }
  }

  return lastCollectionKey;
}

async function handleRtTopRated(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  machineId: string,
  ruleConfig: RuleConfig,
  labels: string[],
): Promise<string | null> {
  let lastCollectionKey: string | null = null;
  const omdbKey = getConfig("global_omdb_api_key");
  if (!omdbKey) {
    throw new Error("OMDB API key is required for RT Top Rated rules. Configure it in Settings.");
  }

  const limit = Math.min(ruleConfig.limit ?? 100, 200);

  for (const section of sections) {
    ctx.log(`[RT Top Rated] "${section.title}" — fetching all items with GUIDs...`);
    const items = await client.allItemsWithGuids(section.key);
    ctx.log(`Found ${items.length} item(s). Fetching Rotten Tomatoes scores via OMDB...`);

    const scored: Array<{ ratingKey: string; title: string; score: number }> = [];
    const queue = new PQueue({ concurrency: 5 });
    let fetched = 0;

    for (const item of items) {
      const imdbId = extractImdbId(item.guids);
      if (!imdbId) continue;

      void queue.add(async () => {
        const ratings = await getOmdbClient().getRatings(imdbId);
        fetched++;
        if (fetched % 50 === 0) {
          ctx.log(`OMDB progress: ${fetched} items fetched...`);
        }

        if (ratings?.rtRating) {
          const scoreMatch = ratings.rtRating.match(/(\d+)%/);
          if (scoreMatch) {
            scored.push({
              ratingKey: item.ratingKey,
              title: item.title,
              score: parseInt(scoreMatch[1], 10),
            });
          }
        }
      });
    }

    await queue.onIdle();
    ctx.log(`Fetched ratings for ${fetched} item(s), ${scored.length} have RT scores.`);

    if (scored.length === 0) {
      ctx.log(`No items with RT scores in "${section.title}", skipping.`);
      continue;
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);
    const ratingKeys = top.map((i) => i.ratingKey);
    const collectionName = `Rotten Tomatoes Top ${limit} in ${section.title}`;

    ctx.log(`Creating "${collectionName}" (${ratingKeys.length} items)...`);
    const collectionKey = await client.createCollectionWithLabel(
      section.key,
      section.type,
      machineId,
      collectionName,
      ratingKeys,
      labels,
    );

    if (collectionKey) {
      await client.pinToHomepage(section.key, collectionKey, {
        promotedToOwnHome: 1,
        promotedToRecommendedHome: 1,
        promotedToSharedHome: 1,
      });
      ctx.log(`Pinned "${collectionName}" to homepage`);
      await upsertCollectionByKey(client, section, collectionKey);
      lastCollectionKey = collectionKey;
    }
  }

  return lastCollectionKey;
}

async function handleSeerrRequests(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  machineId: string,
  rule: Rule,
  ruleConfig: RuleConfig,
  labels: string[],
): Promise<string | null> {
  const seerrUrl = getConfig("global_seerr_url");
  const seerrApiKey = getConfig("global_seerr_api_key");
  if (!seerrUrl || !seerrApiKey) {
    throw new Error("Seerr URL and API key are required. Configure them in Settings > Arrs.");
  }

  const limit = Math.min(ruleConfig.limit ?? 50, 200);
  const filter = ruleConfig.filter || "all";

  // Seerr requests yield a single collection. Pick the first movie/show
  // section the user selected as the host (Plex collections are section-scoped).
  const hostSection = sections.find((s) => s.type === "movie" || s.type === "show");
  if (!hostSection) {
    ctx.log(`[Seerr Requests] No movie or show sections selected, skipping.`);
    return null;
  }
  const sectionMediaType = hostSection.type === "movie" ? "movie" : "tv";
  ctx.log(`[Seerr Requests] Host section: "${hostSection.title}" (${sectionMediaType})`);

  ctx.log(`[Seerr Requests] Indexing "${hostSection.title}" by TMDB ID...`);
  const items = await client.allItemsWithGuids(hostSection.key);
  const tmdbToRatingKey = new Map<number, string>();
  for (const item of items) {
    for (const guid of item.guids) {
      const match = guid.match(/tmdb:\/\/(\d+)/);
      if (match) {
        tmdbToRatingKey.set(parseInt(match[1], 10), item.ratingKey);
        break;
      }
    }
  }
  ctx.log(`[Seerr Requests] ${tmdbToRatingKey.size}/${items.length} items have TMDB IDs.`);

  ctx.log(`[Seerr Requests] Streaming Seerr requests (filter=${filter}) until ${limit} matches...`);
  const { iterSeerrRequests } = await import("@tinkerbell/seerr");
  const ratingKeys: string[] = [];
  const seenRatingKeys = new Set<string>();
  let scanned = 0;
  for await (const req of iterSeerrRequests({ url: seerrUrl, apiKey: seerrApiKey, filter })) {
    scanned++;
    if (req.media.mediaType !== sectionMediaType) continue;
    const ratingKey = tmdbToRatingKey.get(req.media.tmdbId);
    if (!ratingKey || seenRatingKeys.has(ratingKey)) continue;
    seenRatingKeys.add(ratingKey);
    ratingKeys.push(ratingKey);
    if (ratingKeys.length >= limit) break;
  }
  ctx.log(`[Seerr Requests] Scanned ${scanned} request(s); matched ${ratingKeys.length}/${limit}.`);

  if (ratingKeys.length === 0) {
    ctx.log(`[Seerr Requests] No matching items in "${hostSection.title}", skipping.`);
    return null;
  }

  const collectionName = rule.name;
  ctx.log(`Creating "${collectionName}" (${ratingKeys.length} items)...`);
  const collectionKey = await client.createCollectionWithLabel(
    hostSection.key,
    hostSection.type,
    machineId,
    collectionName,
    ratingKeys,
    labels,
  );

  if (collectionKey) {
    await client.pinToHomepage(hostSection.key, collectionKey, {
      promotedToOwnHome: 1,
      promotedToRecommendedHome: 1,
      promotedToSharedHome: 1,
    });
    ctx.log(`Pinned "${collectionName}" to homepage`);
    await upsertCollectionByKey(client, hostSection, collectionKey);
  }

  return collectionKey;
}

// ─── Test / Preview ──────────────────────────────────────────────────────────

export interface TestCollectionPreview {
  name: string;
  sectionTitle: string;
  items: Array<{ title: string; year?: number }>;
}

export interface TestRuleResult {
  collections: TestCollectionPreview[];
  tokensIn?: number;
  tokensOut?: number;
}

export async function testRule(ruleId: string, signal?: AbortSignal, ctxIn?: JobContext): Promise<TestRuleResult> {
  const ctx: JobContext = ctxIn ?? {
    log: (...args: unknown[]) => console.log("[test-rule]", ...args),
    progress: () => {},
    signal: signal || new AbortController().signal,
  };
  const log = ctx.log;
  const progress = ctx.progress;
  let tokensIn = 0;
  let tokensOut = 0;
  const startTime = Date.now();

  progress(0, 4, "Starting test…");
  log(`Starting test for rule "${ruleId}"`);

  const { getRule } = await import("../domains/rules.ts");

  const rule = getRule(ruleId);
  if (!rule) {
    log(`Rule "${ruleId}" not found`);
    throw new Error(`Rule "${ruleId}" not found`);
  }

  log(`Rule: "${rule.name}" (type: ${rule.type})`);
  progress(1, 4, "Connecting to Plex…");

  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  if (!PLEX_TOKEN) {
    log("Error: Plex token not configured");
    throw new Error("Plex token is required. Configure it in Settings.");
  }

  log(`Connecting to Plex at ${PLEX_URL}`);
  const client = createPlexClient({ url: PLEX_URL, token: PLEX_TOKEN, signal, onHealth: plexHealthCallback });

  log("Fetching Plex sections...");
  let allSections = await client.getSections();
  log(`Found ${allSections.length} section(s): ${allSections.map((s) => s.title).join(", ")}`);

  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
    log(`Filtered to configured libraries: ${allSections.map((s) => s.title).join(", ")}`);
  }

  const ruleConfig = parseRuleConfig(rule);
  log("Rule config:", JSON.stringify(ruleConfig));
  progress(2, 4, "Resolving sections…");

  let sections: PlexSection[];
  if (ruleConfig.sections && ruleConfig.sections.length > 0) {
    const names = ruleConfig.sections.map((s) => s.trim().toLowerCase());
    sections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
    if (sections.length === 0) {
      log(`Error: No matching sections for filter: ${ruleConfig.sections.join(", ")}`);
      throw new Error("No matching sections for rule config.");
    }
    log(`Sections filtered by rule config: ${sections.map((s) => s.title).join(", ")}`);
  } else {
    sections = allSections;
    log(`Using all sections: ${sections.map((s) => s.title).join(", ")}`);
  }

  progress(3, 4, `Processing ${sections.length} section${sections.length !== 1 ? "s" : ""}…`);
  const collections: TestCollectionPreview[] = [];

  switch (rule.type) {
    case "ai_prompt": {
      log("[ai_prompt] Starting AI prompt test");
      const ANTHROPIC_API_KEY = getConfig("global_anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
      if (!ANTHROPIC_API_KEY) {
        log("[ai_prompt] Error: Anthropic API key not configured");
        throw new Error("Anthropic API key is required for AI prompt rules.");
      }

      const maxCollections = ruleConfig.limit ?? 8;
      const minItems = ruleConfig.minItems ?? 15;
      const themes = ruleConfig.themes ?? [];
      const customThemes = ruleConfig.customThemes ?? [];
      log(`[ai_prompt] limit=${maxCollections}, minItems=${minItems}, themes=${themes.length}+${customThemes.length}`);
      if (maxCollections > 10) throw new Error("Limit cannot exceed 10.");

      for (let si = 0; si < sections.length; si++) {
        const section = sections[si];
        progress(si, sections.length, `Section ${si + 1}/${sections.length}: ${section.title} — fetching items…`);
        log(`[ai_prompt] Processing section "${section.title}"...`);
        const items = await client.fetchAllItems(section.key);
        log(`[ai_prompt] Fetched ${items.length} items from "${section.title}"`);
        if (items.length < 10) {
          log(`[ai_prompt] Skipping "${section.title}" — fewer than 10 items`);
          continue;
        }

        const history = getRecentHistory(rule.id, section.key);
        log(`[ai_prompt] Loaded ${history.length} historical collection(s)`);

        const prompt = buildAiPrompt({
          sectionTitle: section.title,
          limit: maxCollections,
          minItems,
          themes,
          customThemes,
          vibe: ruleConfig.vibe,
          nameStyle: ruleConfig.nameStyle,
          history,
        });

        const shuffled = [...items];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const itemList = shuffled.map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`).join("\n");
        const seed = Math.floor(Math.random() * 1_000_000);

        progress(
          si,
          sections.length,
          `Section ${si + 1}/${sections.length}: ${section.title} — calling Claude (${items.length} items)…`,
        );
        log(`[ai_prompt] Sending prompt to Claude (seed=${seed}, ${items.length} items)...`);
        const aiStartTime = Date.now();
        const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
        signal?.throwIfAborted();
        let response;
        try {
          response = await anthropic.messages.create(
            {
              model: "claude-sonnet-4-5-20250929",
              max_tokens: 4096,
              temperature: 1,
              messages: [
                {
                  role: "user",
                  content: `${prompt}\n\nRandom seed for variety: ${seed}\n\nHere are the items:\n${itemList}`,
                },
              ],
            },
            { signal },
          );
          reportHealth(
            "Claude AI",
            "ok",
            `${response.model} — ${response.usage.input_tokens} in, ${response.usage.output_tokens} out`,
          );
        } catch (err) {
          reportHealth("Claude AI", "error", errorMessage(err));
          throw err;
        }
        tokensIn += response.usage.input_tokens;
        tokensOut += response.usage.output_tokens;
        log(
          `[ai_prompt] Claude responded in ${Date.now() - aiStartTime}ms (usage: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out)`,
        );
        progress(si + 1, sections.length, `Section ${si + 1}/${sections.length}: ${section.title} — parsing response…`);

        const text = (response.content[0] as { type: "text"; text: string }).text.trim();
        const noopCtx: JobContext = { log() {}, progress() {}, signal: new AbortController().signal };
        const aiCollections = parseJSON(noopCtx, text);
        log(`[ai_prompt] Parsed ${aiCollections.length} collection(s) from AI response`);

        // Build reverse map: ratingKey → {title, year}
        const titleMap = new Map<string, string>();
        const infoByKey = new Map<string, { title: string; year?: number }>();
        for (const item of items) {
          const key = `${item.title}${item.year ? ` (${item.year})` : ""}`;
          titleMap.set(key, item.ratingKey);
          titleMap.set(item.title, item.ratingKey);
          infoByKey.set(item.ratingKey, { title: item.title, year: item.year });
        }

        for (const col of aiCollections) {
          const matchedItems: Array<{ title: string; year?: number }> = [];
          for (const title of col.items) {
            const rk = titleMap.get(title);
            if (rk) {
              const info = infoByKey.get(rk);
              if (info) matchedItems.push(info);
            }
          }
          log(
            `[ai_prompt] Collection "${col.name}": ${matchedItems.length}/${col.items.length} items matched (min: ${minItems})`,
          );
          if (matchedItems.length < minItems) {
            log(`[ai_prompt] Skipping "${col.name}" — below minItems threshold`);
            continue;
          }
          collections.push({ name: col.name, sectionTitle: section.title, items: matchedItems });
        }
      }
      break;
    }

    case "top_rated":
    case "lowest_rated": {
      const sort = rule.type === "top_rated" ? "rating:desc" : "rating:asc";
      const displayName = rule.type === "top_rated" ? "Top Rated" : "Lowest Rated";
      const limit = ruleConfig.limit ?? 50;
      log(`[${rule.type}] sort=${sort}, limit=${limit}`);

      for (const section of sections) {
        log(`[${rule.type}] Fetching sorted items from "${section.title}"...`);
        const items = await client.fetchItemsSorted(section.key, sort, limit);
        log(`[${rule.type}] Got ${items.length} items from "${section.title}"`);
        if (items.length === 0) continue;
        collections.push({
          name: `${displayName} in ${section.title}`,
          sectionTitle: section.title,
          items: items.map((i) => ({ title: i.title, year: i.year })),
        });
      }
      break;
    }

    case "actors":
    case "studios": {
      const field = rule.type === "actors" ? "actor" : "studio";
      const maxCollections_ = ruleConfig.limit ?? 10;
      log(`[${rule.type}] field=${field}, maxCollections=${maxCollections_}`);

      for (const section of sections) {
        log(`[${rule.type}] Fetching grouped entries from "${section.title}"...`);
        const entries = await client.fetchGroupedByField(section.key, field, maxCollections_);
        log(`[${rule.type}] Got ${entries.length} ${field} group(s) from "${section.title}"`);
        for (const entry of entries) {
          const items = await client.fetchItemsByFilter(entry.key);
          log(`[${rule.type}] "${entry.tag}": ${items.length} items`);
          if (items.length < 3) {
            log(`[${rule.type}] Skipping "${entry.tag}" — fewer than 3 items`);
            continue;
          }
          collections.push({
            name: entry.tag,
            sectionTitle: section.title,
            items: items.map((i) => ({ title: i.title, year: i.year })),
          });
        }
      }
      break;
    }

    case "imdb_chart":
    case "imdb_list": {
      const isChart = rule.type === "imdb_chart";
      const tag = isChart ? "imdb_chart" : "imdb_list";
      const contentId = isChart ? ruleConfig.chart : ruleConfig.listId;
      if (!contentId) throw new Error(`IMDb ${isChart ? "chart" : "list"} ID is required.`);
      log(`[${tag}] Fetching "${contentId}"...`);
      const { name: contentName, imdbIds } = isChart
        ? await fetchImdbChartNormalized(contentId)
        : await fetchImdbListNormalized(contentId);
      log(`[${tag}] "${contentName}": ${imdbIds.length} IMDb IDs`);

      for (const section of sections) {
        log(`[${tag}] Matching against section "${section.title}"...`);
        const items = await client.allItemsWithGuids(section.key);
        log(`[${tag}] Fetched ${items.length} items with GUIDs from "${section.title}"`);
        const imdbToItem = new Map<string, { title: string; year?: number }>();
        for (const item of items) {
          for (const guid of item.guids) {
            const match = guid.match(/imdb:\/\/(tt\d+)/);
            if (match) {
              imdbToItem.set(match[1], { title: item.title, year: item.year });
              break;
            }
          }
        }
        log(`[${tag}] ${imdbToItem.size} items have IMDb IDs in "${section.title}"`);

        const matched = imdbIds
          .map((id) => imdbToItem.get(id))
          .filter((m): m is { title: string; year?: number } => m !== undefined);
        log(`[${tag}] Matched ${matched.length}/${imdbIds.length} entries in "${section.title}"`);
        if (matched.length === 0) continue;
        collections.push({ name: contentName, sectionTitle: section.title, items: matched });
      }
      break;
    }

    case "rt_top_rated": {
      const omdbKey = getConfig("global_omdb_api_key");
      if (!omdbKey) {
        log("[rt_top_rated] Error: OMDB API key not configured");
        throw new Error("OMDB API key is required for RT Top Rated rules.");
      }
      const limit = Math.min(ruleConfig.limit ?? 100, 200);
      log(`[rt_top_rated] limit=${limit}`);

      for (const section of sections) {
        log(`[rt_top_rated] Processing section "${section.title}"...`);
        signal?.throwIfAborted();
        const items = await client.allItemsWithGuids(section.key);
        log(`[rt_top_rated] Fetched ${items.length} items with GUIDs from "${section.title}"`);
        const scored: Array<{ title: string; year?: number; score: number }> = [];
        const queue = new PQueue({ concurrency: 5 });
        let omdbLookups = 0;

        if (signal) {
          signal.addEventListener("abort", () => queue.clear(), { once: true });
        }

        for (const item of items) {
          const imdbId = extractImdbId(item.guids);
          if (!imdbId) continue;
          omdbLookups++;
          void queue.add(async () => {
            signal?.throwIfAborted();
            const ratings = await getOmdbClient().getRatings(imdbId);
            if (ratings?.rtRating) {
              const scoreMatch = ratings.rtRating.match(/(\d+)%/);
              if (scoreMatch) {
                scored.push({ title: item.title, year: item.year, score: parseInt(scoreMatch[1], 10) });
              }
            }
          });
        }
        log(`[rt_top_rated] Queued ${omdbLookups} OMDB lookups for "${section.title}"...`);
        await queue.onIdle();
        signal?.throwIfAborted();

        log(`[rt_top_rated] ${scored.length}/${omdbLookups} items have RT scores in "${section.title}"`);
        if (scored.length === 0) continue;
        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, limit);
        log(`[rt_top_rated] Top score: ${top[0].score}%, bottom of top ${limit}: ${top[top.length - 1].score}%`);
        collections.push({
          name: `Rotten Tomatoes Top ${limit} in ${section.title}`,
          sectionTitle: section.title,
          items: top.map((i) => ({ title: i.title, year: i.year })),
        });
      }
      break;
    }

    case "seerr_requests": {
      const seerrUrl = getConfig("global_seerr_url");
      const seerrApiKey = getConfig("global_seerr_api_key");
      if (!seerrUrl || !seerrApiKey) {
        throw new Error("Seerr URL and API key are required. Configure them in Settings > Arrs.");
      }
      const limit = Math.min(ruleConfig.limit ?? 50, 200);
      const filter = ruleConfig.filter || "all";
      log(`[seerr_requests] filter=${filter}, limit=${limit}`);

      const hostSection = sections.find((s) => s.type === "movie" || s.type === "show");
      if (!hostSection) {
        log(`[seerr_requests] No movie or show sections selected; nothing to preview.`);
        break;
      }
      const sectionMediaType = hostSection.type === "movie" ? "movie" : "tv";
      log(`[seerr_requests] Host section "${hostSection.title}" (${sectionMediaType})`);

      const items = await client.allItemsWithGuids(hostSection.key);
      const tmdbToItem = new Map<number, { title: string; year?: number }>();
      for (const item of items) {
        for (const guid of item.guids) {
          const match = guid.match(/tmdb:\/\/(\d+)/);
          if (match) {
            tmdbToItem.set(parseInt(match[1], 10), { title: item.title, year: item.year });
            break;
          }
        }
      }
      log(`[seerr_requests] ${tmdbToItem.size}/${items.length} items have TMDB IDs in "${hostSection.title}"`);

      const { iterSeerrRequests } = await import("@tinkerbell/seerr");
      const matched: { title: string; year?: number }[] = [];
      const seenTmdb = new Set<number>();
      let scanned = 0;
      for await (const req of iterSeerrRequests({ url: seerrUrl, apiKey: seerrApiKey, filter })) {
        signal?.throwIfAborted();
        scanned++;
        if (req.media.mediaType !== sectionMediaType) continue;
        if (seenTmdb.has(req.media.tmdbId)) continue;
        const item = tmdbToItem.get(req.media.tmdbId);
        if (!item) continue;
        seenTmdb.add(req.media.tmdbId);
        matched.push(item);
        if (matched.length >= limit) break;
      }
      log(`[seerr_requests] Scanned ${scanned} requests; matched ${matched.length}/${limit}`);
      if (matched.length === 0) break;
      collections.push({ name: rule.name, sectionTitle: hostSection.title, items: matched });
      break;
    }

    default:
      log(`Error: Unknown rule type "${rule.type}"`);
      throw new Error(`Unknown rule type: ${rule.type}`);
  }

  const totalItems = collections.reduce((sum, c) => sum + c.items.length, 0);
  log(`Test complete in ${Date.now() - startTime}ms — ${collections.length} collection(s), ${totalItems} total items`);
  progress(
    4,
    4,
    `Done — ${collections.length} collection${collections.length !== 1 ? "s" : ""}, ${totalItems} item${totalItems !== 1 ? "s" : ""}`,
  );

  return {
    collections,
    tokensIn: tokensIn || undefined,
    tokensOut: tokensOut || undefined,
  };
}

async function dispatchRule(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  machineId: string,
  rule: Rule,
  ruleConfig: RuleConfig,
  labels: string[],
): Promise<string | null> {
  switch (rule.type) {
    case "ai_prompt":
      return handleAiPrompt(ctx, client, sections, machineId, rule, ruleConfig, labels);
    case "top_rated":
      return handleRated(ctx, client, sections, machineId, "rating:desc", ruleConfig, labels, "Top Rated");
    case "lowest_rated":
      return handleRated(ctx, client, sections, machineId, "rating:asc", ruleConfig, labels, "Lowest Rated");
    case "actors":
      return handleGrouped(ctx, client, sections, machineId, "actor", ruleConfig, labels);
    case "studios":
      return handleGrouped(ctx, client, sections, machineId, "studio", ruleConfig, labels);
    case "imdb_chart":
      return handleImdbContent(
        ctx,
        client,
        sections,
        machineId,
        ruleConfig,
        labels,
        fetchImdbChartNormalized,
        ruleConfig.chart || "",
        "chart",
      );
    case "imdb_list":
      return handleImdbContent(
        ctx,
        client,
        sections,
        machineId,
        ruleConfig,
        labels,
        fetchImdbListNormalized,
        ruleConfig.listId || "",
        "list",
      );
    case "rt_top_rated":
      return handleRtTopRated(ctx, client, sections, machineId, ruleConfig, labels);
    case "seerr_requests":
      return handleSeerrRequests(ctx, client, sections, machineId, rule, ruleConfig, labels);
    default:
      return null;
  }
}

export default async function run(ctx: JobContext, config: GenerateJobConfig): Promise<void> {
  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;

  if (!PLEX_TOKEN) {
    throw new Error("Plex token is required. Configure it in Settings.");
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    signal: ctx.signal,
    onHealth: plexHealthCallback,
  });

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

  // Resolve job-level section filter
  let jobSections: PlexSection[];
  if (config.sections && config.sections.length > 0) {
    const names = config.sections.map((s) => s.trim().toLowerCase());
    jobSections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
    if (jobSections.length === 0) {
      throw new Error(`No matching sections found for "${config.sections.join(", ")}".`);
    }
  } else {
    jobSections = allSections;
  }

  const enabledRules = getEnabledRules();
  if (enabledRules.length === 0) {
    ctx.log("No enabled rules found. Configure rules in the admin UI.");
    return;
  }

  ctx.log(`Found ${enabledRules.length} enabled rule(s).`);

  // One-time migration: delete old "Generated"-labeled collections
  for (const section of jobSections) {
    const deleted = await client.deleteCollectionsByLabel(section.key, "Generated");
    if (deleted > 0) {
      ctx.log(`Migrated: deleted ${deleted} old "Generated"-labeled collection(s) from "${section.title}".`);
    }
  }

  for (let i = 0; i < enabledRules.length; i++) {
    const rule = enabledRules[i];
    const ruleConfig = parseRuleConfig(rule);

    ctx.progress(i + 1, enabledRules.length, `Processing rule "${rule.name}"...`);
    ctx.log(`\n--- Rule: "${rule.name}" (${rule.type}) ---`);

    // Resolve sections: rule-level override > job-level
    let sections: PlexSection[];
    if (ruleConfig.sections && ruleConfig.sections.length > 0) {
      const names = ruleConfig.sections.map((s) => s.trim().toLowerCase());
      sections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
      if (sections.length === 0) {
        ctx.log(`No matching sections for rule config, skipping.`);
        continue;
      }
    } else {
      sections = jobSections;
    }

    ctx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);

    // Delete old collections for this rule
    const ruleLabel = `Rule:${rule.id}`;
    for (const section of sections) {
      const deleted = await client.deleteCollectionsByLabel(section.key, ruleLabel);
      if (deleted > 0) {
        ctx.log(`Deleted ${deleted} old collection(s) with label "${ruleLabel}" from "${section.title}".`);
      }
    }

    const labels = ["Tinkerbell", ruleLabel];

    const lastCollectionKey = await dispatchRule(ctx, client, sections, machineId, rule, ruleConfig, labels);

    if (lastCollectionKey) {
      setRuleLastCollection(rule.id, lastCollectionKey);
    }
  }

  ctx.log("\nAll done!");
}

export async function runSingleRule(
  ruleId: string,
  signal?: AbortSignal,
  ctxIn?: JobContext,
): Promise<{ lastCollectionKey: string | null }> {
  const rule = getRule(ruleId);
  if (!rule) throw new Error(`Rule "${ruleId}" not found`);

  const ctx: JobContext = ctxIn ?? {
    log: (...args: unknown[]) => console.log("[run-rule]", ...args),
    progress: () => {},
    signal: signal || new AbortController().signal,
  };
  const log = ctx.log;
  ctx.progress(0, 4, `Running rule "${rule.name}"…`);
  log(`Running rule "${rule.name}" (${rule.type})`);

  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  if (!PLEX_TOKEN) throw new Error("Plex token is required. Configure it in Settings.");

  const client = createPlexClient({ url: PLEX_URL, token: PLEX_TOKEN, signal, onHealth: plexHealthCallback });
  const identity = await client.getIdentity();
  const machineId = identity.machineIdentifier;

  let allSections = await client.getSections();
  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
  }

  const ruleConfig = parseRuleConfig(rule);

  let sections: PlexSection[];
  if (ruleConfig.sections && ruleConfig.sections.length > 0) {
    const names = ruleConfig.sections.map((s) => s.trim().toLowerCase());
    sections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
    if (sections.length === 0) throw new Error("No matching sections for rule config.");
  } else {
    sections = allSections;
  }

  // Delete old collections for this rule
  const ruleLabel = `Rule:${rule.id}`;
  for (const section of sections) {
    const deleted = await client.deleteCollectionsByLabel(section.key, ruleLabel);
    if (deleted > 0) log(`Deleted ${deleted} old collection(s) from "${section.title}"`);
  }

  const labels = ["Tinkerbell", ruleLabel];
  ctx.progress(2, 4, `Generating collections for ${sections.length} section${sections.length !== 1 ? "s" : ""}…`);

  const lastCollectionKey = await dispatchRule(ctx, client, sections, machineId, rule, ruleConfig, labels);

  if (lastCollectionKey) {
    setRuleLastCollection(rule.id, lastCollectionKey);
  }

  ctx.progress(4, 4, "Done");
  log(`Done — lastCollectionKey: ${lastCollectionKey}`);
  return { lastCollectionKey };
}
