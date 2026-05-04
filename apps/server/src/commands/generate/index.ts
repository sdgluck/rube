import { createPlexClient, type PlexClient, type PlexSection } from "@tinkerbell/plex";
import { getConfig } from "../../lib/config.ts";
import { plexHealthCallback } from "../../lib/clients.ts";
import { getEnabledRules, getRule, setRuleLastCollection, setRuleArrCounts } from "../../domains/rules.ts";
import type { JobContext, GenerateJobConfig } from "../../lib/job-context.ts";
import { parseRuleConfig } from "./config.ts";
import { runHandlerWithCommits } from "./dispatch.ts";
import { resolveArrAdds } from "./arr.ts";

export type { TestRuleResult, TestCollectionPreview } from "./preview.ts";
export { testRule } from "./preview.ts";

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

  // One-time migration: delete old "Generated"-labeled collections.
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

    // Rule-level section override beats job-level.
    const ruleSectionsOrNull = filterSections(allSections, ruleConfig.sections);
    if (ruleSectionsOrNull === null) {
      ctx.log(`No matching sections for rule config, skipping.`);
      continue;
    }
    const sections = ruleSectionsOrNull ?? jobSections;
    ctx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);

    await deleteOldCollections(ctx, client, sections, rule.id);

    const labels = ["Tinkerbell", `Rule:${rule.id}`];
    const { lastCollectionKey } = await runHandlerWithCommits(
      { ctx, client, sections, rule, ruleConfig },
      machineId,
      labels,
    );
    if (lastCollectionKey) setRuleLastCollection(rule.id, lastCollectionKey);

    const arrResult = await resolveArrAdds(ctx, client, sections, rule, ruleConfig);
    if (ruleConfig.arr?.enabled) {
      setRuleArrCounts(rule.id, arrResult.added, arrResult.skipped, arrResult.failed);
    }
  }

  ctx.log("\nAll done!");
}

/** Single-rule entry point used by the admin UI's "Run now" action. */
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
  const { lastCollectionKey } = await runHandlerWithCommits(
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
  return { lastCollectionKey };
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

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    signal: signal ?? ctx.signal,
    onHealth: plexHealthCallback,
  });

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
