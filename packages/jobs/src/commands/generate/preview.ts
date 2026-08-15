import { createPlexClient, type PlexSection } from "@tinkerbell/plex";
import { getConfig } from "@tinkerbell/core";
import { plexHealthCallback } from "@tinkerbell/core";
import { getRule } from "@tinkerbell/domain.rules";
import { createLogger, noopCheckpoint, type JobContext } from "@tinkerbell/core";

import { ruleAction } from "@tinkerbell/contracts";
import { listCandidates } from "@tinkerbell/domain.cleanup";
import { parseRuleConfig } from "./config.ts";
import { handlerForRule } from "./dispatch.ts";

const testRuleLog = createLogger("test-rule");

export interface TestCollectionPreview {
  name: string;
  sectionTitle: string;
  items: Array<{ ratingKey: string; title: string; year?: number; thumb?: string }>;
}

/**
 * What a cleanup rule would do, without doing any of it.
 *
 * A preview that showed only the final number would hide the interesting case:
 * a rule matching 800 items of which 3 are due tells you something very
 * different from one matching 3. Both counts, always.
 */
export interface TestCleanupPreview {
  mode: string;
  dryRun: boolean;
  consecutiveRuns: number;
  /** Items the selection matched this time. */
  matched: number;
  /** Of those, how many would be actioned if this were a real run. */
  dueThisRun: number;
  /** The rest — still building a streak. */
  waiting: number;
  /** Titles that would be actioned, for the preview list. */
  dueTitles: string[];
}

export interface TestRuleResult {
  collections: TestCollectionPreview[];
  tokensIn?: number;
  tokensOut?: number;
  /** Set only for rules whose outcome is cleanup. */
  cleanup?: TestCleanupPreview;
}

/**
 * Run a rule's handler in dry mode — no Plex writes, no history append —
 * and convert each yielded collection into a UI-friendly preview shape.
 * Token usage from the AI handler is summed via the `onAiUsage` callback.
 */
export async function testRule(ruleId: string, signal?: AbortSignal, ctxIn?: JobContext): Promise<TestRuleResult> {
  const ctx: JobContext = ctxIn ?? {
    log: (...args: unknown[]) => testRuleLog.info(args.map(String).join(" ")),
    progress: () => {},
    signal: signal || new AbortController().signal,
    // A dry-run preview writes nothing and resumes nothing.
    checkpoint: noopCheckpoint,
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

  // For a cleanup rule the collections above are the *candidate* set, not
  // something that would be built as-is. Work out what would actually happen,
  // reading the ledger without writing to it — a preview must never advance a
  // streak, or previewing three times would be enough to delete something.
  const action = ruleAction(ruleConfig);
  let cleanup: TestCleanupPreview | undefined;
  if (action.kind === "cleanup") {
    const existing = new Map(listCandidates(rule.id).map((c) => [c.ratingKey, c]));
    const due: string[] = [];
    let waiting = 0;
    for (const collection of collections) {
      for (const item of collection.items) {
        const row = existing.get(item.ratingKey);
        if (row?.actionedAt != null) continue;
        const held = row?.heldUntil != null && row.heldUntil > Date.now();
        const wouldBe = (row?.streak ?? 0) + 1;
        if (!held && wouldBe >= action.consecutiveRuns) due.push(item.title);
        else waiting++;
      }
    }
    cleanup = {
      mode: action.mode,
      dryRun: action.dryRun,
      consecutiveRuns: action.consecutiveRuns,
      matched: totalItems,
      dueThisRun: due.length,
      waiting,
      dueTitles: due.slice(0, 50),
    };
    log(
      `Cleanup preview: ${totalItems} item(s) match; ${due.length} would be ${action.mode}d on a real run; ${waiting} need more consecutive matches.`,
    );
  }

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
    cleanup,
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
