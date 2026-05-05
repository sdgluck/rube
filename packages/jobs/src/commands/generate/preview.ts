import { createPlexClient, type PlexSection } from "@tinkerbell/plex";
import { getConfig } from "@tinkerbell/core";
import { plexHealthCallback } from "@tinkerbell/core";
import { getRule } from "@tinkerbell/domain.rules";
import type { JobContext } from "@tinkerbell/core";
import { parseRuleConfig } from "./config.ts";
import { handlerForRule } from "./dispatch.ts";

export interface TestCollectionPreview {
  name: string;
  sectionTitle: string;
  items: Array<{ ratingKey: string; title: string; year?: number; thumb?: string }>;
}

export interface TestRuleResult {
  collections: TestCollectionPreview[];
  tokensIn?: number;
  tokensOut?: number;
}

/**
 * Run a rule's handler in dry mode — no Plex writes, no history append —
 * and convert each yielded collection into a UI-friendly preview shape.
 * Token usage from the AI handler is summed via the `onAiUsage` callback.
 */
export async function testRule(ruleId: string, signal?: AbortSignal, ctxIn?: JobContext): Promise<TestRuleResult> {
  const ctx: JobContext = ctxIn ?? {
    log: (...args: unknown[]) => console.log("[test-rule]", ...args),
    progress: () => {},
    signal: signal || new AbortController().signal,
  };
  const log = ctx.log;
  const progress = ctx.progress;
  const startTime = Date.now();

  progress(0, 4, "Starting test…");
  log(`Starting test for rule "${ruleId}"`);

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

  const sections = resolveSections(allSections, ruleConfig.sections, log);

  progress(3, 4, `Processing ${sections.length} section${sections.length !== 1 ? "s" : ""}…`);

  const handler = handlerForRule(rule.type);
  if (!handler) {
    log(`Error: Unknown rule type "${rule.type}"`);
    throw new Error(`Unknown rule type: ${rule.type}`);
  }

  const collections: TestCollectionPreview[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  for await (const pending of handler({
    ctx,
    client,
    sections,
    rule,
    ruleConfig,
    onAiUsage: (i, o) => {
      tokensIn += i;
      tokensOut += o;
    },
  })) {
    collections.push({
      name: pending.name,
      sectionTitle: pending.section.title,
      items: pending.matched.map(({ ratingKey, title, year }) => ({ ratingKey, title, year })),
    });
  }

  const totalItems = collections.reduce((sum, c) => sum + c.items.length, 0);

  // Enrich items with thumb paths so the UI can render posters. One batched
  // request across all collections, then back-fill each item.
  const allKeys = Array.from(new Set(collections.flatMap((c) => c.items.map((i) => i.ratingKey))));
  if (allKeys.length > 0) {
    try {
      const thumbs = await client.getThumbsByRatingKeys(allKeys);
      for (const c of collections) {
        for (const it of c.items) {
          const t = thumbs.get(it.ratingKey);
          if (t) it.thumb = t;
        }
      }
    } catch (err) {
      log(`Warning: failed to fetch thumbs for preview — ${(err as Error).message}`);
    }
  }

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

function resolveSections(
  allSections: PlexSection[],
  filter: string[] | undefined,
  log: JobContext["log"],
): PlexSection[] {
  if (!filter || filter.length === 0) {
    log(`Using all sections: ${allSections.map((s) => s.title).join(", ")}`);
    return allSections;
  }
  const names = filter.map((s) => s.trim().toLowerCase());
  const matched = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
  if (matched.length === 0) {
    log(`Error: No matching sections for filter: ${filter.join(", ")}`);
    throw new Error("No matching sections for rule config.");
  }
  log(`Sections filtered by rule config: ${matched.map((s) => s.title).join(", ")}`);
  return matched;
}
