import { eq, desc, and, gte, sql } from "drizzle-orm";
import { db } from "./db/index.ts";
import { healthChecks } from "./db/schema.ts";

export function reportHealth(service: string, status: "ok" | "error", message: string): void {
  db.insert(healthChecks).values({ service, status, message, timestamp: Date.now() }).run();
}

export function getHealthLatest(): Array<{ service: string; status: string; message: string; timestamp: number }> {
  // Get the latest entry per service using a subquery for max timestamp
  const rows = db
    .select()
    .from(healthChecks)
    .where(
      eq(
        healthChecks.id,
        sql`(SELECT id FROM health_checks h2 WHERE h2.service = ${healthChecks.service} ORDER BY h2.timestamp DESC LIMIT 1)`,
      ),
    )
    .all();

  return rows.map((r) => ({
    service: r.service,
    status: r.status,
    message: r.message,
    timestamp: r.timestamp,
  }));
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
