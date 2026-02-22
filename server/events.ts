import { desc, sql } from "drizzle-orm";
import { db } from "./db/index.ts";
import { events } from "./db/schema.ts";
import { notifyEvent } from "./notifications.ts";

export function emitEvent(type: string, message: string, metadata?: Record<string, unknown>): void {
  db.insert(events)
    .values({
      type,
      message,
      metadata: metadata ? JSON.stringify(metadata) : null,
      timestamp: Date.now(),
    })
    .run();

  notifyEvent(type, message);
}

export function getEvents({ limit = 50, offset = 0 }: { limit?: number; offset?: number }): {
  items: Array<{ id: number; type: string; message: string; metadata: string | null; timestamp: number }>;
  total: number;
} {
  const items = db.select().from(events).orderBy(desc(events.timestamp)).limit(limit).offset(offset).all();

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .get();

  return { items, total: countResult?.count ?? 0 };
}

export function pruneEvents(): void {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  db.delete(events)
    .where(sql`${events.timestamp} < ${cutoff}`)
    .run();
}
