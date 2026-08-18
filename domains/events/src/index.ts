import { desc, asc, eq, and, inArray, sql } from "drizzle-orm";
import { events, likeContains, type Db } from "@tinkerbell/db";
import { MONTH_MS } from "@tinkerbell/core";
import { type Notifier } from "@tinkerbell/ports";
import { token } from "@tinkerbell/container";

interface EventFilters {
  limit?: number;
  offset?: number;
  /** Event types to include. Empty means every type passes. */
  types?: string[];
  search?: string;
  sort?: string;
  sortDir?: "asc" | "desc";
}

const SORT_COLUMNS = {
  timestamp: events.timestamp,
  type: events.type,
  message: events.message,
} as const;

export interface EventItem {
  id: number;
  type: string;
  message: string;
  metadata: Record<string, unknown> | null;
  timestamp: number;
  count: number;
  avgDurationMs: number | null;
}

function rollupKey(e: { type: string; message: string; metadata: Record<string, unknown> | null }): string {
  const meta = e.metadata ?? {};
  const sub = (meta as Record<string, unknown>).jobId ?? (meta as Record<string, unknown>).service;
  // NUL is the delimiter because it can't occur in a `type` or a service id,
  // so two different pairs can never collide into the same key. Written as the
  // `\u0000` escape rather than a raw byte: a literal NUL makes grep, ugrep and
  // file(1) classify this whole file as binary and silently skip it, which has
  // already cost two investigations and put one wrong claim into a plan doc.
  return `${e.type}\u0000${sub != null ? String(sub) : e.message}`;
}

/**
 * Extract a duration from the tail of a job-completion message produced by
 * `formatDuration` in `@tinkerbell/core` — either "<n>s" or "<m>m <n>s",
 * anchored at end-of-string so unrelated numbers in the middle of the
 * message ("3s into 5s window") don't match.
 *
 * This is the reason `formatDuration`'s output shape is load-bearing rather
 * than cosmetic: change it and every duration in the activity feed silently
 * stops rolling up. `packages/core/src/time.test.ts` pins the round trip.
 */
export function parseDurationMs(message: string): number | null {
  const match = message.match(/(?:(\d+)m )?(\d+)s$/);
  if (!match) return null;
  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = Number(match[2]);
  return (minutes * 60 + seconds) * 1000;
}

export function rollupConsecutiveEvents(
  rows: Array<{
    id: number;
    type: string;
    message: string;
    metadata: Record<string, unknown> | null;
    timestamp: number;
  }>,
): EventItem[] {
  const result: EventItem[] = [];
  let durationSum = 0;
  let durationCount = 0;
  for (const row of rows) {
    const last = result[result.length - 1];
    const dur = parseDurationMs(row.message);
    if (last && rollupKey(last) === rollupKey(row)) {
      last.count += 1;
      if (row.timestamp > last.timestamp) last.timestamp = row.timestamp;
      if (dur != null) {
        durationSum += dur;
        durationCount += 1;
        last.avgDurationMs = durationSum / durationCount;
      }
    } else {
      durationSum = dur ?? 0;
      durationCount = dur != null ? 1 : 0;
      result.push({
        ...row,
        count: 1,
        avgDurationMs: dur,
      });
    }
  }
  return result;
}

export interface EventsDeps {
  db: Db;
  notifyEvent: Notifier;
}
export function createEvents(deps: EventsDeps) {
  const { db, notifyEvent } = deps;

  function emitEvent(type: string, message: string, metadata?: Record<string, unknown>): void {
    db.insert(events)
      .values({
        type,
        message,
        metadata: metadata ?? null,
        timestamp: Date.now(),
      })
      .run();

    notifyEvent(type, message, metadata);
  }

  function getEvents(filters: EventFilters): { items: EventItem[]; total: number } {
    const { limit = 50, offset = 0 } = filters;
    const conditions = [];

    const types = filters.types ?? [];
    if (types.length > 0) {
      conditions.push(types.length === 1 ? eq(events.type, types[0]) : inArray(events.type, types));
    }
    if (filters.search) {
      conditions.push(likeContains(events.message, filters.search));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const allRows = db.select().from(events).where(whereClause).orderBy(desc(events.timestamp)).all();
    const rolled = rollupConsecutiveEvents(allRows);

    const sortKey = (filters.sort as keyof typeof SORT_COLUMNS) ?? "timestamp";
    const dir = filters.sortDir === "asc" ? 1 : -1;
    const sorted = [...rolled].sort((a, b) => {
      if (sortKey === "type") return a.type.localeCompare(b.type) * dir;
      if (sortKey === "message") return a.message.localeCompare(b.message) * dir;
      return (a.timestamp - b.timestamp) * dir;
    });

    const items = sorted.slice(offset, offset + limit);
    return { items, total: rolled.length };
  }

  function getEventTypes(): string[] {
    const rows = db.select({ type: events.type }).from(events).groupBy(events.type).orderBy(asc(events.type)).all();
    return rows.map((r) => r.type);
  }

  function pruneEvents(): void {
    const cutoff = Date.now() - MONTH_MS;
    db.delete(events)
      .where(sql`${events.timestamp} < ${cutoff}`)
      .run();
  }

  return { emitEvent, getEvents, getEventTypes, pruneEvents };
}

export type Events = ReturnType<typeof createEvents>;

export const EventsToken = token<Events>("events");
