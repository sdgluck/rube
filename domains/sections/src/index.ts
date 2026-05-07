/**
 * Sections module — sync Plex sections to local SQLite and query them.
 */

import { lt } from "drizzle-orm";
import { db, plexSections } from "@tinkerbell/db";
import type { PlexClient } from "@tinkerbell/plex";

interface SyncStats {
  synced: number;
  removed: number;
}

export async function syncSections(client: PlexClient): Promise<SyncStats> {
  const now = Date.now();
  const sections = await client.getSections();

  for (const section of sections) {
    db.insert(plexSections)
      .values({
        key: section.key,
        title: section.title,
        type: section.type,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: plexSections.key,
        set: {
          title: section.title,
          type: section.type,
          syncedAt: now,
        },
      })
      .run();
  }

  // Single bulk delete for any row not refreshed in this pass — matches the
  // pattern in domains/collections and domains/media. Avoids the previous
  // SELECT + per-row DELETE loop, which was racy under concurrent inserts
  // and slow on large libraries.
  const result = db.delete(plexSections).where(lt(plexSections.syncedAt, now)).run();
  const removed = Number(result.changes ?? 0);

  return { synced: sections.length, removed };
}

export function getLocalSections(): Array<{ key: string; title: string; type: string }> {
  return db
    .select({ key: plexSections.key, title: plexSections.title, type: plexSections.type })
    .from(plexSections)
    .all();
}
