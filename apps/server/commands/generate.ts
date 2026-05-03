import Anthropic from "@anthropic-ai/sdk";
import PQueue from "p-queue";
import { createPlexClient, type PlexClient, type PlexSection } from "../plex.ts";
import { getConfig } from "../config.ts";
import { getEnabledRules, getRule, setRuleLastCollection, type Rule } from "../rules.ts";
import { fetchImdbChart, fetchImdbList } from "../imdb.ts";
import { extractImdbId, getOmdbRatings } from "../omdb.ts";
import { reportHealth } from "../health.ts";
import type { JobContext, GenerateJobConfig } from "../shared/job-context.ts";

interface AiCollection {
  name: string;
  items: string[];
}

interface RuleConfig {
  prompt?: string;
  limit?: number;
  minItems?: number;
  sections?: string[];
  chart?: string;
  listId?: string;
  filter?: string;
}

async function fetchImdbChartNormalized(id: string): Promise<{ name: string; imdbIds: string[] }> {
  return fetchImdbChart(id);
}

async function fetchImdbListNormalized(id: string): Promise<{ name: string; imdbIds: string[] }> {
  const result = await fetchImdbList(id);
  return { name: result.title, imdbIds: result.imdbIds };
}

function parseRuleConfig(rule: Rule): RuleConfig {
  try {
    return JSON.parse(rule.config || "{}");
  } catch {
    return {};
  }
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

  const promptTemplate = ruleConfig.prompt || "";
  const maxCollections = ruleConfig.limit ?? 8;
  const minItems = ruleConfig.minItems ?? 15;

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

    const prompt = promptTemplate
      .replace(/\{sectionTitle\}/g, sectionTitle)
      .replace(/\{limit\}/g, String(maxCollections))
      .replace(/\{minItems\}/g, String(minItems));

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
      reportHealth("Claude AI", "error", (err as Error).message);
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
    for (const col of aiCollections) {
      const ratingKeys = col.items.map((title) => titleMap.get(title)).filter(Boolean) as string[];

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
        lastCollectionKey = collectionKey;
        created++;
      }
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
        const ratings = await getOmdbRatings(imdbId);
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
  let lastCollectionKey: string | null = null;
  const seerrUrl = getConfig("global_seerr_url");
  const seerrApiKey = getConfig("global_seerr_api_key");
  if (!seerrUrl || !seerrApiKey) {
    throw new Error("Seerr URL and API key are required. Configure them in Settings > Arrs.");
  }

  const limit = Math.min(ruleConfig.limit ?? 50, 200);
  const filter = ruleConfig.filter || "all";

  ctx.log(`[Seerr Requests] Fetching requests (filter: ${filter}, limit: ${limit})...`);
  const { fetchSeerrRequests } = await import("../seerr.ts");
  const requests = await fetchSeerrRequests({ url: seerrUrl, apiKey: seerrApiKey, filter, limit });
  ctx.log(`Fetched ${requests.length} request(s) from Seerr.`);

  for (const section of sections) {
    const sectionMediaType = section.type === "movie" ? "movie" : "tv";
    const sectionRequests = requests.filter((r) => r.media.mediaType === sectionMediaType);

    if (sectionRequests.length === 0) {
      ctx.log(`[Seerr Requests] No ${sectionMediaType} requests for "${section.title}", skipping.`);
      continue;
    }

    ctx.log(`[Seerr Requests] "${section.title}" — matching ${sectionRequests.length} requests against library...`);
    const items = await client.allItemsWithGuids(section.key);

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

    const ratingKeys = sectionRequests.map((r) => tmdbToRatingKey.get(r.media.tmdbId)).filter(Boolean) as string[];

    if (ratingKeys.length === 0) {
      ctx.log(`No matching items found in "${section.title}", skipping.`);
      continue;
    }

    const collectionName = rule.name;
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
      lastCollectionKey = collectionKey;
    }
  }

  return lastCollectionKey;
}

// ─── Test / Preview ──────────────────────────────────────────────────────────

export interface TestCollectionPreview {
  name: string;
  sectionTitle: string;
  items: Array<{ title: string; year?: number }>;
}

export interface TestRuleResult {
  collections: TestCollectionPreview[];
}

export async function testRule(ruleId: string, signal?: AbortSignal): Promise<TestRuleResult> {
  const log = (...args: unknown[]) => console.log("[test-rule]", ...args);
  const startTime = Date.now();

  log(`Starting test for rule "${ruleId}"`);

  const { getRule } = await import("../rules.ts");

  const rule = getRule(ruleId);
  if (!rule) {
    log(`Rule "${ruleId}" not found`);
    throw new Error(`Rule "${ruleId}" not found`);
  }

  log(`Rule: "${rule.name}" (type: ${rule.type})`);

  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  if (!PLEX_TOKEN) {
    log("Error: Plex token not configured");
    throw new Error("Plex token is required. Configure it in Settings.");
  }

  log(`Connecting to Plex at ${PLEX_URL}`);
  const client = createPlexClient({ url: PLEX_URL, token: PLEX_TOKEN, signal });

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

  const collections: TestCollectionPreview[] = [];

  switch (rule.type) {
    case "ai_prompt": {
      log("[ai_prompt] Starting AI prompt test");
      const ANTHROPIC_API_KEY = getConfig("global_anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
      if (!ANTHROPIC_API_KEY) {
        log("[ai_prompt] Error: Anthropic API key not configured");
        throw new Error("Anthropic API key is required for AI prompt rules.");
      }

      const promptTemplate = ruleConfig.prompt || "";
      const maxCollections = ruleConfig.limit ?? 8;
      const minItems = ruleConfig.minItems ?? 15;
      log(`[ai_prompt] limit=${maxCollections}, minItems=${minItems}, promptLength=${promptTemplate.length}`);
      if (maxCollections > 10) throw new Error("Limit cannot exceed 10.");

      for (const section of sections) {
        log(`[ai_prompt] Processing section "${section.title}"...`);
        const items = await client.fetchAllItems(section.key);
        log(`[ai_prompt] Fetched ${items.length} items from "${section.title}"`);
        if (items.length < 10) {
          log(`[ai_prompt] Skipping "${section.title}" — fewer than 10 items`);
          continue;
        }

        const prompt = promptTemplate
          .replace(/\{sectionTitle\}/g, section.title)
          .replace(/\{limit\}/g, String(maxCollections))
          .replace(/\{minItems\}/g, String(minItems));

        const shuffled = [...items];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const itemList = shuffled.map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`).join("\n");
        const seed = Math.floor(Math.random() * 1_000_000);

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
          reportHealth("Claude AI", "error", (err as Error).message);
          throw err;
        }
        log(
          `[ai_prompt] Claude responded in ${Date.now() - aiStartTime}ms (usage: ${response.usage.input_tokens} in, ${response.usage.output_tokens} out)`,
        );

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

        const matched = imdbIds.map((id) => imdbToItem.get(id)).filter(Boolean) as Array<{
          title: string;
          year?: number;
        }>;
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
            const ratings = await getOmdbRatings(imdbId);
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

      const { fetchSeerrRequests } = await import("../seerr.ts");
      const requests = await fetchSeerrRequests({ url: seerrUrl, apiKey: seerrApiKey, filter, limit });
      log(`[seerr_requests] Fetched ${requests.length} request(s) from Seerr`);

      for (const section of sections) {
        const sectionMediaType = section.type === "movie" ? "movie" : "tv";
        const sectionRequests = requests.filter((r) => r.media.mediaType === sectionMediaType);
        log(`[seerr_requests] ${sectionRequests.length} ${sectionMediaType} requests for "${section.title}"`);

        if (sectionRequests.length === 0) continue;

        const items = await client.allItemsWithGuids(section.key);
        log(`[seerr_requests] Fetched ${items.length} items with GUIDs from "${section.title}"`);

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
        log(`[seerr_requests] ${tmdbToItem.size} items have TMDB IDs in "${section.title}"`);

        const matched = sectionRequests.map((r) => tmdbToItem.get(r.media.tmdbId)).filter(Boolean) as Array<{
          title: string;
          year?: number;
        }>;
        log(`[seerr_requests] Matched ${matched.length}/${sectionRequests.length} requests in "${section.title}"`);
        if (matched.length === 0) continue;
        collections.push({ name: rule.name, sectionTitle: section.title, items: matched });
      }
      break;
    }

    default:
      log(`Error: Unknown rule type "${rule.type}"`);
      throw new Error(`Unknown rule type: ${rule.type}`);
  }

  const totalItems = collections.reduce((sum, c) => sum + c.items.length, 0);
  log(`Test complete in ${Date.now() - startTime}ms — ${collections.length} collection(s), ${totalItems} total items`);

  return { collections };
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
): Promise<{ lastCollectionKey: string | null }> {
  const rule = getRule(ruleId);
  if (!rule) throw new Error(`Rule "${ruleId}" not found`);

  const log = (...args: unknown[]) => console.log("[run-rule]", ...args);
  log(`Running rule "${rule.name}" (${rule.type})`);

  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  if (!PLEX_TOKEN) throw new Error("Plex token is required. Configure it in Settings.");

  const client = createPlexClient({ url: PLEX_URL, token: PLEX_TOKEN, signal });
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
  const ctx: JobContext = { log, progress: () => {}, signal: signal || new AbortController().signal };

  const lastCollectionKey = await dispatchRule(ctx, client, sections, machineId, rule, ruleConfig, labels);

  if (lastCollectionKey) {
    setRuleLastCollection(rule.id, lastCollectionKey);
  }

  log(`Done — lastCollectionKey: ${lastCollectionKey}`);
  return { lastCollectionKey };
}
