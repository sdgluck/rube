import { desc, asc, eq, like, and, sql } from "drizzle-orm";
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

interface EventFilters {
  limit?: number;
  offset?: number;
  type?: string;
  search?: string;
  sort?: string;
  sortDir?: "asc" | "desc";
}

const SORT_COLUMNS = {
  timestamp: events.timestamp,
  type: events.type,
  message: events.message,
} as const;

export function getEvents(filters: EventFilters): {
  items: Array<{ id: number; type: string; message: string; metadata: string | null; timestamp: number }>;
  total: number;
} {
  const { limit = 50, offset = 0 } = filters;
  const conditions = [];

  if (filters.type) {
    conditions.push(eq(events.type, filters.type));
  }
  if (filters.search) {
    conditions.push(like(events.message, `%${filters.search}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const sortCol = SORT_COLUMNS[filters.sort as keyof typeof SORT_COLUMNS] ?? events.timestamp;
  const orderFn = filters.sortDir === "asc" ? asc : desc;

  const items = db.select().from(events).where(whereClause).orderBy(orderFn(sortCol)).limit(limit).offset(offset).all();

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(whereClause)
    .get();

  return { items, total: countResult?.count ?? 0 };
}

export function getEventTypes(): string[] {
  const rows = db.select({ type: events.type }).from(events).groupBy(events.type).orderBy(asc(events.type)).all();
  return rows.map((r) => r.type);
}

export function pruneEvents(): void {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  db.delete(events)
    .where(sql`${events.timestamp} < ${cutoff}`)
    .run();
}
