import { eq, desc, and, gte, sql } from "drizzle-orm";
import { db } from "./db/index.ts";
import { healthChecks } from "./db/schema.ts";
import { emitEvent } from "./events.ts";

export function reportHealth(service: string, status: "ok" | "error", message: string): void {
  // Check previous status for this service to detect transitions
  const prev = db
    .select({ status: healthChecks.status })
    .from(healthChecks)
    .where(eq(healthChecks.service, service))
    .orderBy(desc(healthChecks.timestamp))
    .limit(1)
    .get();

  db.insert(healthChecks).values({ service, status, message, timestamp: Date.now() }).run();

  if (prev) {
    if (prev.status === "ok" && status === "error") {
      emitEvent("health.failed", `${service}: ${message}`, { service });
    } else if (prev.status === "error" && status === "ok") {
      emitEvent("health.recovered", `${service} recovered`, { service });
    }
  }
}

export function getHealthLatest(
  services: string[],
): Array<{ service: string; status: string; message: string; timestamp: number }> {
  const results: Array<{ service: string; status: string; message: string; timestamp: number }> = [];
  for (const service of services) {
    const row = db
      .select()
      .from(healthChecks)
      .where(eq(healthChecks.service, service))
      .orderBy(desc(healthChecks.timestamp))
      .limit(1)
      .get();
    if (row) {
      results.push({ service: row.service, status: row.status, message: row.message, timestamp: row.timestamp });
    }
  }
  return results;
}

export function getHealthHistory(service: string, since: number): Array<{ status: string; timestamp: number }> {
  return db
    .select({ status: healthChecks.status, timestamp: healthChecks.timestamp })
    .from(healthChecks)
    .where(and(eq(healthChecks.service, service), gte(healthChecks.timestamp, since)))
    .orderBy(healthChecks.timestamp)
    .all();
}

// Keep the table from growing unbounded — delete entries older than 7 days
export function pruneHealthChecks(): void {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  db.delete(healthChecks)
    .where(sql`${healthChecks.timestamp} < ${cutoff}`)
    .run();
}
