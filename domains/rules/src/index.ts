import { randomUUID } from "node:crypto";
import { eq, type InferSelectModel } from "drizzle-orm";
import { db, rules } from "@tinkerbell/db";

export {
  acquireRuleLock,
  renewRuleLock,
  releaseRuleLock,
  getRuleLock,
  withRuleLock,
  RuleLockedError,
  RULE_LOCK_LEASE_MS,
  type RuleLockHandle,
  type RuleLockInfo,
} from "./lock.ts";

export type Rule = InferSelectModel<typeof rules>;

export function getRules(): Rule[] {
  return db.select().from(rules).orderBy(rules.createdAt).all();
}

export function getRule(id: string): Rule | undefined {
  return db.select().from(rules).where(eq(rules.id, id)).get();
}

export function getEnabledRules(): Rule[] {
  return db.select().from(rules).where(eq(rules.enabled, 1)).orderBy(rules.createdAt).all();
}

/** Where an imported rule came from. Null throughout for hand-made rules —
 *  see the column comments in the schema for how these drive update prompts. */
export interface RuleProvenance {
  registryRuleSlug?: string | null;
  registryPackSlug?: string | null;
  registryVersion?: number | null;
  registryConfigHash?: string | null;
}

export function createRule(
  input: {
    name: string;
    type: string;
    config: Record<string, unknown>;
    enabled?: boolean;
  } & RuleProvenance,
): Rule {
  const id = randomUUID();
  const now = Date.now();
  const enabled = input.enabled === false ? 0 : 1;
  const provenance = {
    registryRuleSlug: input.registryRuleSlug ?? null,
    registryPackSlug: input.registryPackSlug ?? null,
    registryVersion: input.registryVersion ?? null,
    registryConfigHash: input.registryConfigHash ?? null,
  };
  db.insert(rules)
    .values({
      id,
      name: input.name,
      type: input.type,
      config: input.config,
      enabled,
      createdAt: now,
      ...provenance,
    })
    .run();
  return {
    id,
    name: input.name,
    type: input.type,
    enabled,
    config: input.config,
    createdAt: now,
    ...provenance,
    lastCollectionRatingKey: null,
    lastRunAt: null,
    lastRunDurationMs: null,
    lastRunCollectionCount: null,
    lastRunItemCount: null,
    lastRunStatus: null,
    lastRunError: null,
    lastTestAt: null,
    lastTestDurationMs: null,
    lastTestCollectionCount: null,
    lastTestItemCount: null,
    lastTestStatus: null,
    lastTestError: null,
    lastRunArrAddedCount: null,
    lastRunArrSkippedCount: null,
    lastRunArrFailedCount: null,
    lastPinnedCollections: {},
    // Null, not "now": the per-rule scheduler adopts the current occurrence on
    // its next tick, so a rule saved at 10:05 with an hourly cron waits for
    // 11:00 rather than firing the moment it is created.
    lastScheduledAt: null,
    windowClearedAt: null,
  };
}

export function updateRule(
  id: string,
  updates: { name?: string; enabled?: number; config?: Record<string, unknown> } & RuleProvenance,
): void {
  const sets: Record<string, unknown> = {};
  if (updates.name !== undefined) sets.name = updates.name;
  if (updates.enabled !== undefined) sets.enabled = updates.enabled;
  if (updates.config !== undefined) sets.config = updates.config;
  if (updates.registryVersion !== undefined) sets.registryVersion = updates.registryVersion;
  if (updates.registryConfigHash !== undefined) sets.registryConfigHash = updates.registryConfigHash;
  if (Object.keys(sets).length === 0) return;
  db.update(rules).set(sets).where(eq(rules.id, id)).run();
}

export function setRuleLastCollection(id: string, ratingKey: string): void {
  db.update(rules).set({ lastCollectionRatingKey: ratingKey }).where(eq(rules.id, id)).run();
}

/**
 * Record which collections a pin rotation put on the homepage, so the next
 * run can rotate a different set in. Keyed by section, then collection name
 * — see the column comment in the schema for why names and not rating keys.
 */
export function setRuleLastPinnedCollections(id: string, bySection: Record<string, string[]>): void {
  db.update(rules).set({ lastPinnedCollections: bySection }).where(eq(rules.id, id)).run();
}

/**
 * Mark this rule's own cron as satisfied up to `at`.
 *
 * Written only by the per-rule scheduler, never by a manual run — see the
 * column comment for why the two must not share a timestamp.
 */
export function setRuleLastScheduled(id: string, at: number): void {
  db.update(rules).set({ lastScheduledAt: at }).where(eq(rules.id, id)).run();
}

/**
 * Remember (or forget) that this rule's collections have been torn down for
 * being out of season. Null on re-entry, so leaving the window a year later
 * tears down again rather than assuming it was already done.
 */
export function setRuleWindowCleared(id: string, at: number | null): void {
  db.update(rules).set({ windowClearedAt: at }).where(eq(rules.id, id)).run();
}

export function setRuleArrCounts(id: string, added: number, skipped: number, failed: number): void {
  db.update(rules)
    .set({
      lastRunArrAddedCount: added,
      lastRunArrSkippedCount: skipped,
      lastRunArrFailedCount: failed,
    })
    .where(eq(rules.id, id))
    .run();
}

export interface RuleRunOutcome {
  status: "ok" | "error" | "cancelled";
  durationMs: number;
  collectionCount?: number;
  itemCount?: number;
  error?: string;
}

export function setRuleLastRun(id: string, outcome: RuleRunOutcome): void {
  db.update(rules)
    .set({
      lastRunAt: Date.now(),
      lastRunDurationMs: outcome.durationMs,
      lastRunCollectionCount: outcome.collectionCount ?? null,
      lastRunItemCount: outcome.itemCount ?? null,
      lastRunStatus: outcome.status,
      lastRunError: outcome.error ?? null,
    })
    .where(eq(rules.id, id))
    .run();
}

export function setRuleLastTest(id: string, outcome: RuleRunOutcome): void {
  db.update(rules)
    .set({
      lastTestAt: Date.now(),
      lastTestDurationMs: outcome.durationMs,
      lastTestCollectionCount: outcome.collectionCount ?? null,
      lastTestItemCount: outcome.itemCount ?? null,
      lastTestStatus: outcome.status,
      lastTestError: outcome.error ?? null,
    })
    .where(eq(rules.id, id))
    .run();
}

export function deleteRule(id: string): void {
  db.delete(rules).where(eq(rules.id, id)).run();
}

export function seedDefaultRules(): void {
  const existing = db.select({ id: rules.id }).from(rules).limit(1).all();
  if (existing.length > 0) return;

  createRule({
    name: "AI Curated Collections",
    type: "ai_prompt",
    config: {
      themes: ["Vibes & tone", "Visual style & cinematography", "Unexpected pairings", "Moods & atmospheres"],
      customThemes: [],
      vibe: "mixed",
      nameStyle: "short_punchy",
      limit: 8,
      minItems: 15,
    },
  });
  console.log("[rules] Seeded default AI prompt rule");
}
