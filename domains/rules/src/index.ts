import { randomUUID } from "node:crypto";
import { desc, eq, type InferSelectModel } from "drizzle-orm";
import { db, rules } from "@tinkerbell/db";
import { rememberDeletedRule } from "./recycle.ts";
import { SEEDED_RULE } from "@tinkerbell/contracts";

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

export { explainItem, type ClauseVerdict, type ItemExplanation } from "./explain.ts";

export {
  conflictsForRule,
  findRuleConflicts,
  rulesProducingCollectionNamed,
  rulesWithOrderedWrites,
  type ConflictKind,
  type RuleConflict,
} from "./conflicts.ts";

export {
  listDeletedRules,
  pruneDeletedRules,
  rememberDeletedRule,
  restoreDeletedRules,
  RESTORE_WINDOW_MS,
  type DeletedRuleSummary,
} from "./recycle.ts";

/**
 * Every rule, in running order.
 *
 * `position` first, `createdAt` as the tiebreak. Existing installs have every
 * rule at position 0, so they keep exactly the creation order they had until
 * somebody reorders something.
 */
export function getRules(): Rule[] {
  return db.select().from(rules).orderBy(rules.position, rules.createdAt).all();
}

export function getRule(id: string): Rule | undefined {
  return db.select().from(rules).where(eq(rules.id, id)).get();
}

export function getEnabledRules(): Rule[] {
  return db.select().from(rules).where(eq(rules.enabled, 1)).orderBy(rules.position, rules.createdAt).all();
}

/**
 * Move a rule to a new position, renumbering the rest.
 *
 * Renumbers rather than nudging one value: gaps and ties accumulate otherwise,
 * and the order the user sees has to be the order the engine reads, with no
 * ambiguity left for `createdAt` to resolve differently after an edit.
 *
 * `orderedIds` is usually a *subset* — each Rules page shows one ending, so a
 * drag on /cleanup/rules sends only the cleanup rules. Numbering that subset
 * 0..n-1 would stamp it over the collection and metadata rules sharing the
 * sequence, so instead the named rules are dealt back into the slots they
 * already occupy in the global order, in their new relative order, and
 * everything else keeps the slot it had.
 */
export function reorderRules(orderedIds: string[]): void {
  db.transaction(() => {
    const all = db.select({ id: rules.id }).from(rules).orderBy(rules.position, rules.createdAt).all();
    const known = new Set(all.map((r) => r.id));
    // An id for a rule deleted between the page load and the drop would
    // otherwise shift every rule after it by one.
    // De-duplicated as well as filtered. A payload naming the same id twice —
    // which the input schema doesn't forbid — dealt that id into two slots and
    // dropped the last entry off the end, leaving one rule never updated and two
    // holding positions that don't match what was dropped.
    const queue = [...new Set(orderedIds.filter((id) => known.has(id)))];
    const moving = new Set(queue);
    let next = 0;
    const reordered = all.map((r) => (moving.has(r.id) ? queue[next++] : r.id));
    reordered.forEach((id, index) => {
      db.update(rules).set({ position: index }).where(eq(rules.id, id)).run();
    });
  });
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
  // A new rule goes on the end. Position 0 would tie it with every rule on an
  // install that has never reordered anything, leaving `createdAt` to break
  // the tie — which is the right answer, but only by accident.
  const highest = db.select({ position: rules.position }).from(rules).orderBy(desc(rules.position)).limit(1).get();
  const position = (highest?.position ?? -1) + 1;

  db.insert(rules)
    .values({
      id,
      name: input.name,
      type: input.type,
      config: input.config,
      enabled,
      position,
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
    position,
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

/**
 * Delete a rule, keeping enough of it to put back.
 *
 * The tombstone is written first: if the copy fails, the rule is still there,
 * which is the recoverable half of the two.
 */
export function deleteRule(id: string): void {
  rememberDeletedRule(id);
  db.delete(rules).where(eq(rules.id, id)).run();
}

export function seedDefaultRules(): void {
  const existing = db.select({ id: rules.id }).from(rules).limit(1).all();
  if (existing.length > 0) return;

  createRule({
    ...SEEDED_RULE,
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
