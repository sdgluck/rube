import Anthropic from "@anthropic-ai/sdk";
import { createPlexClient, type PlexClient, type PlexItem, type PlexSection } from "../plex.ts";
import { getConfig } from "../config.ts";
import { getEnabledRules, type Rule } from "../rules.ts";
import type { JobContext, GenerateJobConfig } from "../../shared/job-context.ts";

interface AiCollection {
  name: string;
  items: string[];
}

interface RuleConfig {
  prompt?: string;
  limit?: number;
  sections?: string[];
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
      .replace(/\{limit\}/g, String(maxCollections));

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
      default:
        ctx.log(`Unknown rule type: ${rule.type}, skipping.`);
    }
  }

  ctx.log("\nAll done!");
}
