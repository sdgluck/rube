import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { metadataOverrides, type Db } from "@tinkerbell/db";
import { token } from "@tinkerbell/container";

/**
 * Per-item metadata overrides: the edits somebody made by hand, kept so they
 * can be re-applied.
 *
 * The domain deliberately does no Plex writing — that's the apply job's, and it
 * goes through the same snapshot-then-write ledger every other metadata write
 * uses. What lives here is the store and the matching, which is the part that
 * has to be right: an override that matches the wrong film writes somebody
 * else's summary onto it.
 */

export interface OverrideMatch {
  title: string;
  year?: number;
  imdb?: string;
  tmdb?: number;
}

export interface OverrideInput {
  sectionId: string;
  match: OverrideMatch;
  fields: Record<string, string>;
  tags: Record<string, string[]>;
  source?: string;
}

export type MetadataOverrideRow = typeof metadataOverrides.$inferSelect;

/** An indexed library, as the resolver needs it. */
export interface ResolverIndex {
  byImdb: Map<string, string>;
  byTmdb: Map<number, string>;
  /** Normalised `title` → rating keys. Several films share a title. */
  byTitle: Map<string, Array<{ ratingKey: string; year?: number }>>;
}

/** The same normalisation the asset matcher uses, for the same reasons. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Find the item an override belongs to.
 *
 * Ids first, always: they're unambiguous, and a config that carries one carries
 * it precisely because its author knew the title wasn't enough. Title matching
 * is the fallback, and it refuses to guess — two films called "The Thing" with
 * no year between them is not a match, it's a question, and answering it wrong
 * writes one film's metadata onto the other.
 */
export function resolveOverride(index: ResolverIndex, match: OverrideMatch): string | null {
  if (match.imdb) {
    const hit = index.byImdb.get(match.imdb);
    if (hit) return hit;
  }
  if (match.tmdb != null) {
    const hit = index.byTmdb.get(match.tmdb);
    if (hit) return hit;
  }

  const candidates = index.byTitle.get(normaliseTitle(match.title)) ?? [];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.ratingKey;

  if (match.year != null) {
    const exact = candidates.filter((c) => c.year === match.year);
    if (exact.length === 1) return exact[0]!.ratingKey;
  }

  // Ambiguous. Better to report it than to pick one.
  return null;
}

export interface MetadataOverridesDeps {
  db: Db;
}

export function createMetadataOverrides(deps: MetadataOverridesDeps) {
  const { db } = deps;

  /**
   * Store overrides, replacing any that match the same item.
   *
   * Re-importing a config is a normal thing to do — somebody fixes one summary
   * and imports again — so the unique index makes that an update rather than a
   * second row fighting the first.
   */
  function upsertOverrides(inputs: OverrideInput[]): number {
    if (inputs.length === 0) return 0;
    const now = Date.now();

    db.transaction((tx) => {
      for (const input of inputs) {
        tx.insert(metadataOverrides)
          .values({
            id: randomUUID(),
            sectionId: input.sectionId,
            matchTitle: input.match.title,
            matchYear: input.match.year ?? null,
            matchImdb: input.match.imdb ?? null,
            matchTmdb: input.match.tmdb ?? null,
            ratingKey: null,
            fields: input.fields,
            tags: input.tags,
            source: input.source ?? "manual",
            appliedAt: null,
            lastError: null,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [metadataOverrides.sectionId, metadataOverrides.matchTitle, metadataOverrides.matchYear],
            set: {
              fields: input.fields,
              tags: input.tags,
              matchImdb: input.match.imdb ?? null,
              matchTmdb: input.match.tmdb ?? null,
              source: input.source ?? "manual",
              // An edited override has to be re-applied, so clear the stamp.
              appliedAt: null,
              lastError: null,
            },
          })
          .run();
      }
    });

    return inputs.length;
  }

  function listOverrides(sectionId?: string): MetadataOverrideRow[] {
    const query = db.select().from(metadataOverrides);
    return (sectionId ? query.where(eq(metadataOverrides.sectionId, sectionId)) : query).all();
  }

  /** Overrides still waiting to be written to Plex. */
  function pendingOverrides(): MetadataOverrideRow[] {
    return db.select().from(metadataOverrides).where(isNull(metadataOverrides.appliedAt)).all();
  }

  function markApplied(id: string, ratingKey: string): void {
    db.update(metadataOverrides)
      .set({ ratingKey, appliedAt: Date.now(), lastError: null })
      .where(eq(metadataOverrides.id, id))
      .run();
  }

  function markFailed(id: string, reason: string): void {
    db.update(metadataOverrides).set({ lastError: reason }).where(eq(metadataOverrides.id, id)).run();
  }

  function removeOverride(id: string): void {
    db.delete(metadataOverrides).where(eq(metadataOverrides.id, id)).run();
  }

  /** Drop every override that came from a given source — undoing an import. */
  function forgetSource(source: string): number {
    const rows = db.select().from(metadataOverrides).where(eq(metadataOverrides.source, source)).all();
    db.delete(metadataOverrides).where(eq(metadataOverrides.source, source)).run();
    return rows.length;
  }

  function countBySection(): Array<{ sectionId: string; total: number; applied: number }> {
    const rows = listOverrides();
    const out = new Map<string, { sectionId: string; total: number; applied: number }>();
    for (const row of rows) {
      const entry = out.get(row.sectionId) ?? { sectionId: row.sectionId, total: 0, applied: 0 };
      entry.total++;
      if (row.appliedAt != null) entry.applied++;
      out.set(row.sectionId, entry);
    }
    return [...out.values()];
  }

  /** Overrides for one section that haven't been applied, for the job. */
  function pendingForSection(sectionId: string): MetadataOverrideRow[] {
    return db
      .select()
      .from(metadataOverrides)
      .where(and(eq(metadataOverrides.sectionId, sectionId), isNull(metadataOverrides.appliedAt)))
      .all();
  }

  return {
    upsertOverrides,
    listOverrides,
    pendingOverrides,
    pendingForSection,
    markApplied,
    markFailed,
    removeOverride,
    forgetSource,
    countBySection,
  };
}

export type MetadataOverrides = ReturnType<typeof createMetadataOverrides>;
export const MetadataOverridesToken = token<MetadataOverrides>("metadata-overrides");
