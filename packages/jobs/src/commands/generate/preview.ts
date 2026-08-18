import { type Services } from "@tinkerbell/composition";
import { createDispatchCommand } from "./dispatch.ts";
import { createFunnelCommand } from "./funnel.ts";
import { createPlexClient, type PlexClient, type PlexSection } from "@tinkerbell/plex";

import { createLogger, deriveJobContext, type JobContext } from "@tinkerbell/core";

import { ruleAction, type MetadataActionConfig } from "@tinkerbell/contracts";

import { parseRuleConfig } from "./config.ts";

import { type SectionFunnel } from "./funnel.ts";
import { describe as describeValue, planWrites, type PlannedWrite } from "./metadata.ts";

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

/** One field a metadata rule would change, as the confirmation step renders it. */
export interface TestMetadataDiff {
  ratingKey: string;
  itemTitle: string;
  field: string;
  currentValue: string;
  newValue: string;
  /** Plex has this field locked to something else and the rule won't overwrite it. */
  blocked: boolean;
}

/**
 * What a metadata rule would write, without writing any of it.
 *
 * Nobody should run this blind, and unlike a collection there is no "delete it
 * and re-run" recovery. "Change contentRating on 431 items" is the sentence a
 * user needs to see before agreeing, so the counts here come from the same
 * `planWrites` the run uses — a preview computed a second way is a preview
 * that can disagree with reality.
 */
export interface TestMetadataPreview {
  dryRun: boolean;
  lock: boolean;
  /** Items the selection matched. */
  matched: number;
  /** Of those, how many were read to build this diff. */
  inspected: number;
  /** Field writes that would change something. */
  writes: number;
  /** Distinct items those writes land on. */
  items: number;
  /** Planned writes that would be skipped because the field is locked. */
  blocked: number;
  /** Per-field counts, for the "Change contentRating on 431 items" line. */
  byField: Array<{ field: string; count: number }>;
  /** The first N diffs, in full. */
  diffs: TestMetadataDiff[];
  /** Set when the preview stopped short of reading every matched item. */
  truncated: boolean;
}

export interface TestRuleResult {
  collections: TestCollectionPreview[];
  tokensIn?: number;
  tokensOut?: number;
  /** Set only for rules whose outcome is cleanup. */
  cleanup?: TestCleanupPreview;
  /**
   * Per-clause attrition, for `smart_filter` rules only. The other 28 rule
   * types don't have a filter tree to walk — their selection is a source
   * (an IMDb chart, a TMDb franchise) rather than a stack of conditions.
   */
  funnel?: SectionFunnel[];
  /** Set only for rules whose outcome is a metadata write. */
  metadata?: TestMetadataPreview;
}

/**
 * How many items a preview reads before it stops.
 *
 * A rule matching 5,000 items would otherwise be 5,000 Plex round-trips with a
 * person watching a spinner. The cap is reported rather than hidden — a
 * silently truncated preview reads as "this is everything" when it isn't.
 */
const PREVIEW_READ_LIMIT = 250;

/** Diffs shown in full. The rest are counted. */
const PREVIEW_DIFF_LIMIT = 50;

async function previewMetadata(
  ctx: JobContext,
  client: PlexClient,
  action: MetadataActionConfig,
  collections: TestCollectionPreview[],
): Promise<TestMetadataPreview> {
  // De-duplicated exactly as the run does it: a grouped rule yields a film
  // once per credit, and counting it three times would make the preview
  // promise three times the work.
  const byKey = new Map<string, { ratingKey: string; title: string; collection: string }>();
  for (const collection of collections) {
    for (const item of collection.items) {
      if (!byKey.has(item.ratingKey)) {
        byKey.set(item.ratingKey, { ratingKey: item.ratingKey, title: item.title, collection: collection.name });
      }
    }
  }
  const matches = [...byKey.values()];
  const toRead = matches.slice(0, PREVIEW_READ_LIMIT);

  const planned: PlannedWrite[] = [];
  for (const item of toRead) {
    ctx.signal?.throwIfAborted();
    try {
      const current = await client.getItemFields(item.ratingKey);
      planned.push(
        ...planWrites(
          action,
          // Section is irrelevant to planning — only the write needs it — so
          // the preview doesn't pay to resolve one per item.
          { ...item, sectionId: "", sectionType: "movie", title: item.title },
          current,
        ),
      );
    } catch (err) {
      ctx.log(`Metadata preview: could not read "${item.title}" — ${(err as Error).message}`);
    }
  }

  const byField = new Map<string, number>();
  for (const write of planned) byField.set(write.field, (byField.get(write.field) ?? 0) + 1);

  return {
    dryRun: action.dryRun,
    lock: action.lock,
    matched: matches.length,
    inspected: toRead.length,
    writes: planned.filter((p) => !p.blocked).length,
    items: new Set(planned.filter((p) => !p.blocked).map((p) => p.ratingKey)).size,
    blocked: planned.filter((p) => p.blocked).length,
    byField: [...byField.entries()].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count),
    diffs: planned.slice(0, PREVIEW_DIFF_LIMIT).map((p) => ({
      ratingKey: p.ratingKey,
      itemTitle: p.itemTitle,
      field: p.field,
      currentValue: describeValue(p.currentValue),
      newValue: describeValue(p.newValue),
      blocked: p.blocked,
    })),
    truncated: matches.length > toRead.length,
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

export function createPreviewCommand(deps: Services) {
  const { cleanup, clients, config, rules } = deps;
  const { getConfig } = config;
  const { plexHealthCallback } = clients;
  const { getRule } = rules;
  const { listCandidates, protectedRatingKeys, standingRefusal } = cleanup;
  const { handlerForRule } = createDispatchCommand(deps);
  const { buildFilterFunnel } = createFunnelCommand(deps);

  /**
   * Run a rule's handler in dry mode — no Plex writes, no history append —
   * and convert each yielded collection into a UI-friendly preview shape.
   * Token usage from the AI handler is summed via the `onAiUsage` callback.
   */
  async function testRule(ruleId: string, signal?: AbortSignal, ctxIn?: JobContext): Promise<TestRuleResult> {
    const ctx: JobContext =
      ctxIn ??
      deriveJobContext(deps.scope, {
        log: (...args: unknown[]) => testRuleLog.info(args.map(String).join(" ")),
        signal: signal || new AbortController().signal,
      });
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
      // De-duplicated by rating key, for the same reason `recordMatches` and
      // `previewMetadata` are: a grouped rule yields one group per director, per
      // language, per decade, and an item belongs to as many of those as it has
      // credits or tracks. Counting the appearances made "Test" report three times
      // the matches a real run would record, and name the same film three times.
      const uniqueItems = new Map<string, { ratingKey: string; title: string }>();
      for (const collection of collections) {
        for (const item of collection.items) {
          if (!uniqueItems.has(item.ratingKey)) uniqueItems.set(item.ratingKey, item);
        }
      }

      // The refusals the run would apply, asked the same way it asks them. A Test
      // that lists items the engine refuses to touch is a Test that disagrees with
      // the thing it is previewing.
      const protectedKeys = protectedRatingKeys();
      const refusal = standingRefusal();
      const due: string[] = [];
      let waiting = 0;
      let spared = 0;
      for (const item of uniqueItems.values()) {
        const row = existing.get(item.ratingKey);
        if (row?.actionedAt != null) continue;
        const held = row?.heldUntil != null && row.heldUntil > Date.now();
        if (held || protectedKeys.has(item.ratingKey)) {
          spared++;
          continue;
        }
        const wouldBe = (row?.streak ?? 0) + 1;
        const approved = !action.requireApproval || row?.approvedAt != null;
        if (wouldBe >= action.consecutiveRuns && approved && !refusal) due.push(item.title);
        else waiting++;
      }
      cleanup = {
        mode: action.mode,
        dryRun: action.dryRun,
        consecutiveRuns: action.consecutiveRuns,
        matched: uniqueItems.size,
        dueThisRun: due.length,
        waiting,
        dueTitles: due.slice(0, 50),
      };
      const spareNote = spared > 0 ? `; ${spared} held or protected` : "";
      const refusalNote = refusal ? ` Nothing would be actioned: ${refusal}` : "";
      log(
        `Cleanup preview: ${uniqueItems.size} item(s) match; ${due.length} would be ${action.mode}d on a real run;` +
          ` ${waiting} need more consecutive matches${spareNote}.${refusalNote}`,
      );
    }

    // Where the items went, clause by clause. Built after the handler rather
    // than inside it so a funnel that fails costs nothing but itself, and only
    // for smart filters — every other rule type selects from a source rather
    // than by narrowing, so there is no attrition to attribute.
    let funnel: SectionFunnel[] | undefined;
    if (rule.type === "smart_filter" && ruleConfig.smartFilter?.children.length) {
      log("Measuring where the items went, clause by clause…");
      funnel = await buildFilterFunnel({ ctx, client, sections, filter: ruleConfig.smartFilter });
      for (const section of funnel) {
        const trail = section.steps.map((s) => `${s.label} → ${s.remaining}`).join("; ");
        log(`[Funnel] "${section.sectionTitle}": ${section.start} → ${trail || "no clauses"} → ${section.final}`);
      }
    }

    let metadata: TestMetadataPreview | undefined;
    if (action.kind === "metadata") {
      metadata = await previewMetadata(ctx, client, action, collections);
      log(
        `Metadata preview: ${metadata.writes} field write(s) across ${metadata.items} item(s)` +
          `${metadata.blocked > 0 ? `, ${metadata.blocked} skipped as locked` : ""}.`,
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

    log(
      `Test complete in ${Date.now() - startTime}ms — ${collections.length} collection(s), ${totalItems} total items`,
    );
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
      funnel,
      metadata,
    };
  }

  return { testRule };
}
