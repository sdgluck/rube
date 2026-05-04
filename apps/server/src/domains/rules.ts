import { randomUUID } from "node:crypto";
import { eq, type InferSelectModel } from "drizzle-orm";
import { db, rules } from "@tinkerbell/db";

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

export function createRule(input: { name: string; type: string; config: Record<string, unknown> }): Rule {
  const id = randomUUID();
  const now = Date.now();
  db.insert(rules).values({ id, name: input.name, type: input.type, config: input.config, createdAt: now }).run();
  return {
    id,
    name: input.name,
    type: input.type,
    enabled: 1,
    config: input.config,
    createdAt: now,
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
  };
}

export function updateRule(
  id: string,
  updates: { name?: string; enabled?: number; config?: Record<string, unknown> },
): void {
  const sets: Record<string, unknown> = {};
  if (updates.name !== undefined) sets.name = updates.name;
  if (updates.enabled !== undefined) sets.enabled = updates.enabled;
  if (updates.config !== undefined) sets.config = updates.config;
  if (Object.keys(sets).length === 0) return;
  db.update(rules).set(sets).where(eq(rules.id, id)).run();
}

export function setRuleLastCollection(id: string, ratingKey: string): void {
  db.update(rules).set({ lastCollectionRatingKey: ratingKey }).where(eq(rules.id, id)).run();
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
