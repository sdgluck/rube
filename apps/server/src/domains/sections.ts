/**
 * Sections module — sync Plex sections to local SQLite and query them.
 */

import { eq } from "drizzle-orm";
import { db, plexSections } from "@tinkerbell/db";
import type { PlexClient } from "../clients/plex/index.ts";

interface SyncStats {
  synced: number;
  removed: number;
}

export async function syncSections(client: PlexClient): Promise<SyncStats> {
  const now = Date.now();
  const sections = await client.getSections();
  const seenKeys = new Set<string>();

  for (const section of sections) {
    seenKeys.add(section.key);
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

  // Remove stale entries
  const allRows = db.select({ key: plexSections.key }).from(plexSections).all();
  let removed = 0;
  for (const row of allRows) {
    if (!seenKeys.has(row.key)) {
      db.delete(plexSections).where(eq(plexSections.key, row.key)).run();
      removed++;
    }
  }

  return { synced: sections.length, removed };
}

export function getLocalSections(): Array<{ key: string; title: string; type: string }> {
  return db
    .select({ key: plexSections.key, title: plexSections.title, type: plexSections.type })
    .from(plexSections)
    .all();
}
