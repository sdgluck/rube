import { randomUUID } from "node:crypto";
import { eq, type InferSelectModel } from "drizzle-orm";
import { db } from "./db/index.ts";
import { rules } from "./db/schema.ts";

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

export function createRule(input: { name: string; type: string; config: string }): Rule {
  const id = randomUUID();
  const now = Date.now();
  db.insert(rules).values({ id, name: input.name, type: input.type, config: input.config, createdAt: now }).run();
  return { id, name: input.name, type: input.type, enabled: 1, config: input.config, createdAt: now };
}

export function updateRule(id: string, updates: { name?: string; enabled?: number; config?: string }): void {
  const sets: Record<string, unknown> = {};
  if (updates.name !== undefined) sets.name = updates.name;
  if (updates.enabled !== undefined) sets.enabled = updates.enabled;
  if (updates.config !== undefined) sets.config = updates.config;
  if (Object.keys(sets).length === 0) return;
  db.update(rules).set(sets).where(eq(rules.id, id)).run();
}

export function deleteRule(id: string): void {
  db.delete(rules).where(eq(rules.id, id)).run();
}

const DEFAULT_AI_PROMPT = `You are a movie/TV curator. Given this list of items from a Plex "{sectionTitle}" library, create curated themed collections.

Rules:
- Create exactly {limit} collections
- Each collection MUST have between 15 and 30 items, no fewer than 15
- Each item can appear in multiple collections
- Only use titles that exactly match the input list
- Collection names should be creative, fun, relatively short, not academic, and NEVER use colons (no "Title: Subtitle" format)
- Be surprising and inventive with your themes — avoid obvious genres or decades groupings
- Think of unexpected connections between items: tonal similarities, visual motifs, narrative parallels, thematic undercurrents, shared vibes

Return ONLY valid minified JSON on a single line, no markdown fences, no explanation, no newlines within the JSON. Format:
[{"name":"Collection Name","items":["Title (Year)","Title (Year)"]}]`;

export function seedDefaultRules(): void {
  const existing = db.select({ id: rules.id }).from(rules).limit(1).all();
  if (existing.length > 0) return;

  const config = JSON.stringify({ prompt: DEFAULT_AI_PROMPT, limit: 8 });
  createRule({ name: "AI Curated Collections", type: "ai_prompt", config });
  console.log("[rules] Seeded default AI prompt rule");
}
