/**
 * The collection-presentation ledger: what Tinkerbell has written onto a
 * generated collection's summary and poster, and what was there first.
 *
 * See the table comment in `@tinkerbell/db` for why this is keyed by
 * `(ruleId, collectionName)` and not by rating key.
 */
import { createHash } from "node:crypto";
import { and, eq, type InferSelectModel } from "drizzle-orm";
import { collectionArtwork, type Db } from "@tinkerbell/db";

export type CollectionArtworkRow = InferSelectModel<typeof collectionArtwork>;

type ArtworkPatch = Partial<Omit<CollectionArtworkRow, "ruleId" | "collectionName" | "updatedAt">>;

/**
 * Stable hash for a set of inputs. Used for both `inputHash` (poster render
 * inputs) and `summaryConfigHash` (the rule config an LLM summary was written
 * against), so an unchanged rule never repeats work that costs an upload or an
 * API call.
 */
export function artworkHash(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

export interface ArtworkDeps {
  db: Db;
}
export function createArtwork(deps: ArtworkDeps) {
  const { db } = deps;

  function getCollectionArtwork(ruleId: string, collectionName: string): CollectionArtworkRow | undefined {
    return db
      .select()
      .from(collectionArtwork)
      .where(and(eq(collectionArtwork.ruleId, ruleId), eq(collectionArtwork.collectionName, collectionName)))
      .get();
  }

  function getCollectionArtworkForRule(ruleId: string): CollectionArtworkRow[] {
    return db.select().from(collectionArtwork).where(eq(collectionArtwork.ruleId, ruleId)).all();
  }

  /**
   * Upsert the ledger row, touching only the fields the caller names.
   *
   * A partial write matters here: the summary pass and the poster pass run at
   * different times (one inside the rule run, one in `collection-art`), and
   * whichever goes second must not blank the other's bookkeeping.
   */
  function recordCollectionArtwork(ruleId: string, collectionName: string, patch: ArtworkPatch): void {
    const now = Date.now();
    db.insert(collectionArtwork)
      .values({
        ruleId,
        collectionName,
        inputHash: patch.inputHash ?? "",
        summary: patch.summary ?? "",
        summarySource: patch.summarySource ?? "",
        summaryConfigHash: patch.summaryConfigHash ?? "",
        summaryLockedAt: patch.summaryLockedAt ?? null,
        posterUploadedAt: patch.posterUploadedAt ?? null,
        posterLockedAt: patch.posterLockedAt ?? null,
        priorThumb: patch.priorThumb ?? "",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [collectionArtwork.ruleId, collectionArtwork.collectionName],
        set: { ...patch, updatedAt: now },
      })
      .run();
  }

  /**
   * Forget everything this rule has written. Called by "revert artwork", which
   * is mostly "stop uploading" — the collections themselves are recreated on the
   * next run, so there is no image to put back, only a record to drop so the
   * next run doesn't consider the work already done.
   */
  function forgetCollectionArtwork(ruleId: string): number {
    return db.delete(collectionArtwork).where(eq(collectionArtwork.ruleId, ruleId)).run().changes;
  }

  return { getCollectionArtwork, getCollectionArtworkForRule, recordCollectionArtwork, forgetCollectionArtwork };
}
