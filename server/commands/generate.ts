import Anthropic from "@anthropic-ai/sdk";
import PQueue from "p-queue";
import { createPlexClient, type PlexClient, type PlexItem, type PlexSection } from "../plex.ts";
import { getConfig } from "../config.ts";
import { getEnabledRules, type Rule } from "../rules.ts";
import { fetchImdbChart, fetchImdbList } from "../imdb.ts";
import { extractImdbId, getOmdbRatings } from "../omdb.ts";
import type { JobContext, GenerateJobConfig } from "../../shared/job-context.ts";

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

    const cleaned = match[0].replace(/,\s*([}\]])/g, "$1").replace(/[\x00-\x1f]/g, " ");
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
): Promise<void> {
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
    const response = await anthropic.messages.create({
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
        created++;
      }
    }

    ctx.log(`Created and pinned ${created} collection(s) for "${sectionTitle}".`);
  }
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
): Promise<void> {
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
    }
  }
}

async function handleGrouped(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  machineId: string,
  field: string,
  ruleConfig: RuleConfig,
  labels: string[],
): Promise<void> {
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
        created++;
      }
    }

    ctx.log(`Created ${created} ${field} collection(s) for "${section.title}".`);
  }
}

async function handleImdbChart(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  machineId: string,
  ruleConfig: RuleConfig,
  labels: string[],
): Promise<void> {
  const chartId = ruleConfig.chart;
  if (!chartId) throw new Error("IMDb chart ID is required.");

  ctx.log(`Fetching IMDb chart "${chartId}"...`);
  const { name: chartName, imdbIds } = await fetchImdbChart(chartId);
  ctx.log(`Found ${imdbIds.length} title(s) in "${chartName}".`);

  for (const section of sections) {
    ctx.log(`[${chartName}] "${section.title}" — matching against library...`);
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

    ctx.log(`Creating "${chartName}" (${ratingKeys.length} items)...`);
    const collectionKey = await client.createCollectionWithLabel(
      section.key,
      section.type,
      machineId,
      chartName,
      ratingKeys,
      labels,
    );

    if (collectionKey) {
      await client.pinToHomepage(section.key, collectionKey, {
        promotedToOwnHome: 1,
        promotedToRecommendedHome: 1,
        promotedToSharedHome: 1,
      });
      ctx.log(`Pinned "${chartName}" to homepage`);
    }
  }
}

async function handleImdbList(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  machineId: string,
  ruleConfig: RuleConfig,
  labels: string[],
): Promise<void> {
  const listId = ruleConfig.listId;
  if (!listId) throw new Error("IMDb list ID is required.");

  ctx.log(`Fetching IMDb list "${listId}"...`);
  const { title: listTitle, imdbIds } = await fetchImdbList(listId);
  ctx.log(`Found ${imdbIds.length} title(s) in "${listTitle}".`);

  for (const section of sections) {
    ctx.log(`[${listTitle}] "${section.title}" — matching against library...`);
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

    ctx.log(`Creating "${listTitle}" (${ratingKeys.length} items)...`);
    const collectionKey = await client.createCollectionWithLabel(
      section.key,
      section.type,
      machineId,
      listTitle,
      ratingKeys,
      labels,
    );

    if (collectionKey) {
      await client.pinToHomepage(section.key, collectionKey, {
        promotedToOwnHome: 1,
        promotedToRecommendedHome: 1,
        promotedToSharedHome: 1,
      });
      ctx.log(`Pinned "${listTitle}" to homepage`);
    }
  }
}

async function handleRtTopRated(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  machineId: string,
  ruleConfig: RuleConfig,
  labels: string[],
): Promise<void> {
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
    }
  }
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
  const { getRule } = await import("../rules.ts");

  const rule = getRule(ruleId);
  if (!rule) throw new Error(`Rule "${ruleId}" not found`);

  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  if (!PLEX_TOKEN) throw new Error("Plex token is required. Configure it in Settings.");

  const client = createPlexClient({ url: PLEX_URL, token: PLEX_TOKEN, signal });

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

  const collections: TestCollectionPreview[] = [];

  switch (rule.type) {
    case "ai_prompt": {
      const ANTHROPIC_API_KEY = getConfig("global_anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
      if (!ANTHROPIC_API_KEY) throw new Error("Anthropic API key is required for AI prompt rules.");

      const promptTemplate = ruleConfig.prompt || "";
      const maxCollections = ruleConfig.limit ?? 8;
      const minItems = ruleConfig.minItems ?? 15;
      if (maxCollections > 10) throw new Error("Limit cannot exceed 10.");

      for (const section of sections) {
        const items = await client.fetchAllItems(section.key);
        if (items.length < 10) continue;

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

        const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
        signal?.throwIfAborted();
        const response = await anthropic.messages.create(
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

        const text = (response.content[0] as { type: "text"; text: string }).text.trim();
        const noopCtx: JobContext = { log() {}, progress() {}, signal: new AbortController().signal };
        const aiCollections = parseJSON(noopCtx, text);

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
          if (matchedItems.length < minItems) continue;
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

      for (const section of sections) {
        const items = await client.fetchItemsSorted(section.key, sort, limit);
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

      for (const section of sections) {
        const entries = await client.fetchGroupedByField(section.key, field, maxCollections_);
        for (const entry of entries) {
          const items = await client.fetchItemsByFilter(entry.key);
          if (items.length < 3) continue;
          collections.push({
            name: entry.tag,
            sectionTitle: section.title,
            items: items.map((i) => ({ title: i.title, year: i.year })),
          });
        }
      }
      break;
    }

    case "imdb_chart": {
      const chartId = ruleConfig.chart;
      if (!chartId) throw new Error("IMDb chart ID is required.");
      const { name: chartName, imdbIds } = await fetchImdbChart(chartId);

      for (const section of sections) {
        const items = await client.allItemsWithGuids(section.key);
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

        const matched = imdbIds.map((id) => imdbToItem.get(id)).filter(Boolean) as Array<{
          title: string;
          year?: number;
        }>;
        if (matched.length === 0) continue;
        collections.push({ name: chartName, sectionTitle: section.title, items: matched });
      }
      break;
    }

    case "imdb_list": {
      const listId = ruleConfig.listId;
      if (!listId) throw new Error("IMDb list ID is required.");
      const { title: listTitle, imdbIds } = await fetchImdbList(listId);

      for (const section of sections) {
        const items = await client.allItemsWithGuids(section.key);
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

        const matched = imdbIds.map((id) => imdbToItem.get(id)).filter(Boolean) as Array<{
          title: string;
          year?: number;
        }>;
        if (matched.length === 0) continue;
        collections.push({ name: listTitle, sectionTitle: section.title, items: matched });
      }
      break;
    }

    case "rt_top_rated": {
      const omdbKey = getConfig("global_omdb_api_key");
      if (!omdbKey) throw new Error("OMDB API key is required for RT Top Rated rules.");
      const limit = Math.min(ruleConfig.limit ?? 100, 200);

      for (const section of sections) {
        signal?.throwIfAborted();
        const items = await client.allItemsWithGuids(section.key);
        const scored: Array<{ title: string; year?: number; score: number }> = [];
        const queue = new PQueue({ concurrency: 5 });

        if (signal) {
          signal.addEventListener("abort", () => queue.clear(), { once: true });
        }

        for (const item of items) {
          const imdbId = extractImdbId(item.guids);
          if (!imdbId) continue;
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
        await queue.onIdle();
        signal?.throwIfAborted();

        if (scored.length === 0) continue;
        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, limit);
        collections.push({
          name: `Rotten Tomatoes Top ${limit} in ${section.title}`,
          sectionTitle: section.title,
          items: top.map((i) => ({ title: i.title, year: i.year })),
        });
      }
      break;
    }

    default:
      throw new Error(`Unknown rule type: ${rule.type}`);
  }

  return { collections };
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

    switch (rule.type) {
      case "ai_prompt":
        await handleAiPrompt(ctx, client, sections, machineId, rule, ruleConfig, labels);
        break;
      case "top_rated":
        await handleRated(ctx, client, sections, machineId, "rating:desc", ruleConfig, labels, "Top Rated");
        break;
      case "lowest_rated":
        await handleRated(ctx, client, sections, machineId, "rating:asc", ruleConfig, labels, "Lowest Rated");
        break;
      case "actors":
        await handleGrouped(ctx, client, sections, machineId, "actor", ruleConfig, labels);
        break;
      case "studios":
        await handleGrouped(ctx, client, sections, machineId, "studio", ruleConfig, labels);
        break;
      case "imdb_chart":
        await handleImdbChart(ctx, client, sections, machineId, ruleConfig, labels);
        break;
      case "imdb_list":
        await handleImdbList(ctx, client, sections, machineId, ruleConfig, labels);
        break;
      case "rt_top_rated":
        await handleRtTopRated(ctx, client, sections, machineId, ruleConfig, labels);
        break;
      default:
        ctx.log(`Unknown rule type: ${rule.type}, skipping.`);
    }
  }

  ctx.log("\nAll done!");
}
