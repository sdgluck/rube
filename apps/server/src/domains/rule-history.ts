import { and, desc, eq, lt } from "drizzle-orm";
import { db, ruleHistory } from "@tinkerbell/db";

export interface HistoricalCollection {
  name: string;
  sampleItems: string[];
}

const MAX_RUNS_PER_SECTION = 10;

export function getRecentHistory(ruleId: string, sectionKey: string): HistoricalCollection[] {
  const rows = db
    .select()
    .from(ruleHistory)
    .where(and(eq(ruleHistory.ruleId, ruleId), eq(ruleHistory.sectionKey, sectionKey)))
    .orderBy(desc(ruleHistory.runAt))
    .limit(MAX_RUNS_PER_SECTION)
    .all();

  const flat: HistoricalCollection[] = [];
  for (const row of rows) {
    for (const c of row.collections) flat.push(c);
  }
  return flat;
}

export function appendHistory(
  ruleId: string,
  sectionKey: string,
  sectionTitle: string,
  collections: HistoricalCollection[],
): void {
  if (collections.length === 0) return;
  const runAt = Date.now();
  db.insert(ruleHistory).values({ ruleId, sectionKey, sectionTitle, runAt, collections }).run();

  // Trim: keep only the last MAX_RUNS_PER_SECTION rows for this rule+section.
  const keep = db
    .select({ runAt: ruleHistory.runAt })
    .from(ruleHistory)
    .where(and(eq(ruleHistory.ruleId, ruleId), eq(ruleHistory.sectionKey, sectionKey)))
    .orderBy(desc(ruleHistory.runAt))
    .limit(MAX_RUNS_PER_SECTION)
    .all();
  if (keep.length < MAX_RUNS_PER_SECTION) return;
  const cutoff = keep[keep.length - 1].runAt;
  db.delete(ruleHistory)
    .where(and(eq(ruleHistory.ruleId, ruleId), eq(ruleHistory.sectionKey, sectionKey), lt(ruleHistory.runAt, cutoff)))
    .run();
}

export function clearHistory(ruleId: string): void {
  db.delete(ruleHistory).where(eq(ruleHistory.ruleId, ruleId)).run();
}
