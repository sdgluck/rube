import { createPlexClient, type PlexClient, type PlexSection } from "@tinkerbell/plex";
import { getConfig } from "@tinkerbell/core";
import { plexHealthCallback } from "@tinkerbell/core";
import {
  getEnabledRules,
  getRule,
  setRuleArrCounts,
  setRuleLastCollection,
  setRuleLastRun,
} from "@tinkerbell/domain.rules";
import { errorMessage } from "@tinkerbell/core";
import { createLogger, noopCheckpoint, type JobContext, type GenerateJobConfig } from "@tinkerbell/core";

import { parseRuleConfig } from "./config.ts";
import { runHandlerWithCommits } from "./dispatch.ts";
import { resolveArrAdds } from "./arr.ts";
import { llmUnavailableReason } from "./ai/llm.ts";
import { withItemCache } from "./item-cache.ts";
import { RULE_CONCURRENCY_DEFAULT } from "@tinkerbell/contracts";

export type { TestRuleResult, TestCollectionPreview } from "./preview.ts";
export { testRule } from "./preview.ts";

const runRuleLog = createLogger("run-rule");

/**
 * Batch entry point: run every enabled rule against the configured Plex
 * server. Sections per rule = rule-level filter ∩ job-level filter ∩
 * globally-configured libraries.
 */
export default async function run(ctx: JobContext, config: GenerateJobConfig): Promise<void> {
  const { client, machineId, allSections } = await connectPlex(ctx);
  const jobSectionsOrNull = filterSections(allSections, config.sections);
  if (jobSectionsOrNull === null) {
    throw new Error(`No matching sections found for "${(config.sections ?? []).join(", ")}".`);
  }
  const jobSections = jobSectionsOrNull ?? allSections;

  const enabledRules = getEnabledRules();
  if (enabledRules.length === 0) {
    ctx.log("No enabled rules found. Configure rules in the admin UI.");
    return;
  }

  ctx.log(`Found ${enabledRules.length} enabled rule(s).`);

  // Resume whatever a previous run abandoned. `generate` is the longest job in
  // the system and container restarts on a home server are routine, so
  // restarting from rule zero after an hour of work is a real cost.
  //
  // The checkpoint is discarded when the rule set has changed since it was
  // written — "skip rule X" is only meaningful against the same list.
  const saved = ctx.checkpoint.read<GenerateCheckpoint>();
  const completedRuleIds = new Set<string>(
    saved && sameRuleSet(saved.ruleIds, enabledRules) ? saved.completedRuleIds : [],
  );
  if (saved && completedRuleIds.size === 0 && saved.completedRuleIds.length > 0) {
    ctx.log("Enabled rules changed since the last run — starting from the first rule.");
  }
  if (completedRuleIds.size > 0) {
    ctx.log(`Resuming: skipping ${completedRuleIds.size} rule(s) completed in the previous run.`);
  }
  const checkpointStartedAt = saved && completedRuleIds.size > 0 ? saved.startedAt : Date.now();
  const ruleIds = enabledRules.map((r) => r.id);
  const saveCheckpoint = () =>
    ctx.checkpoint.write({
      startedAt: checkpointStartedAt,
      ruleIds,
      completedRuleIds: [...completedRuleIds],
    } satisfies GenerateCheckpoint);

  // One-time migration: delete old "Generated"-labeled collections.
  for (const section of jobSections) {
    const deleted = await client.deleteCollectionsByLabel(section.key, "Generated");
    if (deleted > 0) {
      ctx.log(`Migrated: deleted ${deleted} old "Generated"-labeled collection(s) from "${section.title}".`);
    }
  }

  // A rule that blows up shouldn't cost the rest of the batch — one bad
  // rule out of 34 used to abandon every rule after it. Failures are
  // recorded per rule and summarised at the end instead.
  const failures: { name: string; error: string }[] = [];

  const concurrency = Math.min(config.ruleConcurrency ?? RULE_CONCURRENCY_DEFAULT, enabledRules.length);
  if (concurrency > 1) ctx.log(`Running up to ${concurrency} rules at a time.`);

  /** Everything one rule does, start to finish. Never throws except on abort. */
  const runOneRule = async (rule: (typeof enabledRules)[number], ruleCtx: JobContext): Promise<void> => {
    const ruleConfig = parseRuleConfig(rule);
    ruleCtx.log(`\n--- Rule: "${rule.name}" (${rule.type}) ---`);

    // AI rules need a working provider. Without one every such rule fails
    // identically, so check once up front and skip rather than delete the
    // rule's existing collections and replace them with nothing.
    if (rule.type === "ai_prompt") {
      const unavailable = llmUnavailableReason();
      if (unavailable) {
        ruleCtx.log(`Skipping AI rule — ${unavailable}.`);
        completedRuleIds.add(rule.id);
        saveCheckpoint();
        return;
      }
    }

    // Rule-level section override beats job-level.
    const ruleSectionsOrNull = filterSections(allSections, ruleConfig.sections);
    if (ruleSectionsOrNull === null) {
      ruleCtx.log(`No matching sections for rule config, skipping.`);
      // A rule with nothing to do is done — don't re-evaluate it on a resume.
      completedRuleIds.add(rule.id);
      saveCheckpoint();
      return;
    }
    const sections = ruleSectionsOrNull ?? jobSections;
    ruleCtx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);

    const labels = ["Tinkerbell", `Rule:${rule.id}`];
    const ruleStartedAt = Date.now();
    try {
      // Inside the try: a Plex hiccup while clearing one rule's old
      // collections is no more fatal than the rule's own handler failing.
      await deleteOldCollections(ruleCtx, client, sections, rule.id);

      const { lastCollectionKey, collectionCount, itemCount } = await runHandlerWithCommits(
        { ctx: ruleCtx, client, sections, rule, ruleConfig },
        machineId,
        labels,
      );
      if (lastCollectionKey) setRuleLastCollection(rule.id, lastCollectionKey);

      const arrResult = await resolveArrAdds(ruleCtx, client, sections, rule, ruleConfig);
      if (ruleConfig.arr?.enabled) {
        setRuleArrCounts(rule.id, arrResult.added, arrResult.skipped, arrResult.failed);
      }

      setRuleLastRun(rule.id, {
        status: "ok",
        durationMs: Date.now() - ruleStartedAt,
        collectionCount,
        itemCount,
      });

      // Only after the rule has fully committed — a checkpoint written any
      // earlier would let a resume skip work that never actually landed.
      completedRuleIds.add(rule.id);
      saveCheckpoint();
    } catch (err) {
      const message = errorMessage(err);
      setRuleLastRun(rule.id, {
        status: "error",
        durationMs: Date.now() - ruleStartedAt,
        error: message,
      });

      // Cancellation and budget timeouts abort `ctx.signal` — that's the whole
      // job ending, not this rule failing, so it still propagates.
      if (ctx.signal.aborted) throw err;

      failures.push({ name: rule.name, error: message });
      ruleCtx.log(`Rule "${rule.name}" failed: ${message}`);
      ruleCtx.log("Continuing with the remaining rules.");
      // Deliberately not checkpointed as complete: a resume should retry it.
    }
  };

  // Rules are independent, so the pool is a plain shared cursor over the
  // list — no locking needed, since only one worker runs between awaits.
  const pending = enabledRules.filter((r) => !completedRuleIds.has(r.id));
  let started = 0;
  let finished = 0;

  const worker = async (): Promise<void> => {
    while (started < pending.length && !ctx.signal.aborted) {
      const rule = pending[started++];
      // With rules interleaved, streaming every line straight to the job log
      // would braid them together and make the log unreadable. Each rule's
      // output is buffered and flushed as one block when it finishes.
      const buffered = concurrency > 1 ? bufferLog(ctx) : { ctx, flush: () => {} };
      try {
        await runOneRule(rule, buffered.ctx);
      } finally {
        buffered.flush();
        finished++;
        ctx.progress(finished, pending.length, `Completed ${finished}/${pending.length} rules`);
      }
    }
  };

  // `allSettled`, not `all`: a worker rejecting (only ever an abort) must not
  // leave its siblings' rejections unhandled — those surface as an
  // unhandled rejection inside the Sidequest worker thread, where nothing
  // catches them. Every worker is waited for, then the first failure wins.
  const outcomes = await Promise.allSettled(Array.from({ length: concurrency }, worker));
  const aborted = outcomes.find((o) => o.status === "rejected");
  if (aborted) throw aborted.reason;

  // Clear on success, so a stale checkpoint can never silently skip a rule on
  // the next nightly run.
  ctx.checkpoint.clear();
  if (failures.length > 0) {
    ctx.log(`\n${failures.length} of ${enabledRules.length} rule(s) failed:`);
    for (const { name, error } of failures) ctx.log(`  - "${name}": ${error}`);
  }
  ctx.log("\nAll done!");
}

/**
 * A context whose log is collected rather than emitted, so one rule's output
 * lands in the job log as a single contiguous block. Mirrors the real
 * context's stringification so buffered lines read identically to live ones.
 */
function bufferLog(ctx: JobContext): { ctx: JobContext; flush: () => void } {
  const lines: string[] = [];
  return {
    ctx: {
      ...ctx,
      log: (...args: unknown[]) =>
        lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")),
    },
    flush: () => {
      if (lines.length > 0) ctx.log(lines.join("\n"));
      lines.length = 0;
    },
  };
}

interface GenerateCheckpoint {
  /** When the first (possibly earlier) run of this checkpoint began. */
  startedAt: number;
  /** The enabled-rule list this checkpoint was written against. */
  ruleIds: string[];
  completedRuleIds: string[];
}

function sameRuleSet(saved: string[], current: { id: string }[]): boolean {
  if (saved.length !== current.length) return false;
  const ids = new Set(current.map((r) => r.id));
  return saved.every((id) => ids.has(id));
}

/** Single-rule entry point used by the admin UI's "Run now" action. */
export async function runSingleRule(
  ruleId: string,
  signal?: AbortSignal,
  ctxIn?: JobContext,
): Promise<{ lastCollectionKey: string | null; collectionCount: number; itemCount: number }> {
  const rule = getRule(ruleId);
  if (!rule) throw new Error(`Rule "${ruleId}" not found`);

  const ctx: JobContext = ctxIn ?? {
    log: (...args: unknown[]) => runRuleLog.info(args.map(String).join(" ")),
    progress: () => {},
    signal: signal || new AbortController().signal,
    // A single ad-hoc rule run has nothing to resume from.
    checkpoint: noopCheckpoint,
  };

  ctx.progress(0, 4, `Running rule "${rule.name}"…`);
  ctx.log(`Running rule "${rule.name}" (${rule.type})`);

  const { client, machineId, allSections } = await connectPlex(ctx, signal);
  const ruleConfig = parseRuleConfig(rule);

  const ruleSectionsOrNull = filterSections(allSections, ruleConfig.sections);
  if (ruleSectionsOrNull === null) throw new Error("No matching sections for rule config.");
  const sections = ruleSectionsOrNull ?? allSections;

  await deleteOldCollections(ctx, client, sections, rule.id);

  ctx.progress(2, 4, `Generating collections for ${sections.length} section${sections.length !== 1 ? "s" : ""}…`);
  const labels = ["Tinkerbell", `Rule:${rule.id}`];
  const { lastCollectionKey, collectionCount, itemCount } = await runHandlerWithCommits(
    { ctx, client, sections, rule, ruleConfig },
    machineId,
    labels,
  );
  if (lastCollectionKey) setRuleLastCollection(rule.id, lastCollectionKey);

  const arrResult = await resolveArrAdds(ctx, client, sections, rule, ruleConfig);
  if (ruleConfig.arr?.enabled) {
    setRuleArrCounts(rule.id, arrResult.added, arrResult.skipped, arrResult.failed);
  }

  ctx.progress(4, 4, "Done");
  ctx.log(`Done — lastCollectionKey: ${lastCollectionKey}`);
  return { lastCollectionKey, collectionCount, itemCount };
}

/**
 * Open a Plex client, fetch identity + sections, and apply the global
 * library allowlist. Shared by `run` and `runSingleRule` because both
 * need the same setup before doing anything rule-specific.
 */
async function connectPlex(
  ctx: JobContext,
  signal?: AbortSignal,
): Promise<{ client: PlexClient; machineId: string; allSections: PlexSection[] }> {
  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  if (!PLEX_TOKEN) throw new Error("Plex token is required. Configure it in Settings.");

  // Memoized for the lifetime of this run: the library can't change under us
  // mid-job, and every rule that walks it was previously paying for its own
  // full pass over the same few thousand items.
  const client = withItemCache(
    createPlexClient({
      url: PLEX_URL,
      token: PLEX_TOKEN,
      signal: signal ?? ctx.signal,
      onHealth: plexHealthCallback,
    }),
  );

  ctx.log(`tinkerbell generate`);
  ctx.log(`Server: ${PLEX_URL}`);

  const identity = await client.getIdentity();
  ctx.log(`Server name: ${identity.friendlyName}`);

  let allSections = await client.getSections();
  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
  }

  return { client, machineId: identity.machineIdentifier, allSections };
}

/**
 * Filter sections by name or key (case-insensitive). Three states:
 *   - `undefined`: no filter set (caller falls back to a broader scope)
 *   - `null`:      filter set but nothing matched (caller decides: error / skip)
 *   - `PlexSection[]`: matches
 */
function filterSections(allSections: PlexSection[], filter: string[] | undefined): PlexSection[] | null | undefined {
  if (!filter || filter.length === 0) return undefined;
  const names = filter.map((s) => s.trim().toLowerCase());
  const matched = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
  return matched.length === 0 ? null : matched;
}

async function deleteOldCollections(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
  ruleId: string,
): Promise<void> {
  const ruleLabel = `Rule:${ruleId}`;
  for (const section of sections) {
    const deleted = await client.deleteCollectionsByLabel(section.key, ruleLabel);
    if (deleted > 0) {
      ctx.log(`Deleted ${deleted} old collection(s) with label "${ruleLabel}" from "${section.title}".`);
    }
  }
}
