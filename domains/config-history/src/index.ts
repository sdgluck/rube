/* ─── What you did to Rube ────────────────────────────────────────────
 *
 * `domains/changes` is the read-model over the five ledgers that record what
 * Rube did to *Plex*. This is the other direction, and it is the one
 * nothing recorded: a rule edited at 2am, a cleanup budget someone raised, a
 * job whose schedule moved.
 *
 * It owns a ledger of its own, which is why it is a separate domain rather
 * than a sixth source inside `domains/changes` — that module's whole design
 * note is that it stores nothing, and a module that stores one thing and reads
 * five is a harder thing to reason about than two modules that each do one.
 *
 * Writes arrive through `ChangeRecorderToken` from four places that sit below
 * this one (the config store, rules, jobs, overlays). None of them may write
 * to `change_log` directly: redaction and the transient-key filter happen
 * here, once, so a new call site cannot skip them.
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { changeLog, type Db } from "@rube/db";
import { token } from "@rube/container";
import { createLogger, currentActor, errorMessage, redactConfigValue, type ConfigKey } from "@rube/core";
import { CHANGE_LOG_ACTIONS, CHANGE_LOG_ENTITIES } from "@rube/contracts";
import type { ChangeAction, ChangeEntity, ChangeRecord } from "@rube/ports";

export { CHANGE_LOG_ACTIONS, CHANGE_LOG_ENTITIES } from "@rube/contracts";

import { diffSnapshots, type FieldChange } from "./diff.ts";

export { diffSnapshots, deepEqual, type FieldChange } from "./diff.ts";

const log = createLogger("history");

/**
 * The lists in `@rube/contracts` and the unions in `@rube/ports`
 * must not drift.
 *
 * Ports owns the types because it owns the recorder edge and may depend on
 * nothing; contracts owns the runtime lists because the browser needs values
 * and cannot import either ports or a domain. This module is the only one that
 * imports both, so it is where they are checked. Both directions of
 * assignability are asserted, so a kind added to one and not the other is a
 * build error rather than a filter that silently omits it.
 */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _entitiesAgree: AssertEqual<ChangeEntity, (typeof CHANGE_LOG_ENTITIES)[number]> = true;
const _actionsAgree: AssertEqual<ChangeAction, (typeof CHANGE_LOG_ACTIONS)[number]> = true;
void _entitiesAgree;
void _actionsAgree;

/**
 * How long a change is kept.
 *
 * Six months: long enough to cover "this stopped working some time last
 * quarter", short enough that a busy install's log stays a table you can read
 * rather than an archive. Pruned by `purge-runs` on the nightly sweep.
 */
export const DEFAULT_HISTORY_RETENTION_DAYS = 180;

export interface HistoryEntry {
  id: number;
  entity: ChangeEntity;
  entityId: string;
  action: ChangeAction;
  source: string;
  username: string;
  timestamp: number;
  before: unknown;
  after: unknown;
  /** Computed at read time — see `diff.ts`. */
  fields: FieldChange[];
  /**
   * Whether this version can be written back.
   *
   * False for a delete (there is no state to restore *to* — the recycle bin on
   * the rules page is the thing that undeletes a rule) and for the newest
   * entry of an entity, which is already the current state.
   */
  restorable: boolean;
}

export interface HistoryQuery {
  entity?: ChangeEntity;
  entityId?: string;
  /** Newest first, capped. */
  limit?: number;
  since?: number;
}

export interface ConfigHistoryDeps {
  db: Db;
}

export function createConfigHistory(deps: ConfigHistoryDeps) {
  const { db } = deps;

  /**
   * The `ChangeRecorder` implementation.
   *
   * Two properties this must have, both learned from what it is recording:
   *
   * 1. **It never throws.** A failed history write must not fail the settings
   *    save it was describing. Losing a log row is bad; refusing to let
   *    somebody fix their Plex URL because the log row wouldn't insert is
   *    worse, and would be a self-inflicted outage on the one screen that
   *    could fix it.
   * 2. **It redacts config values itself**, rather than trusting callers. The
   *    config store already passes redacted values — belt and braces, because
   *    this table is the one place where a missed secret becomes a permanent
   *    plaintext history rather than a single current copy.
   */
  function record(change: ChangeRecord): void {
    try {
      const actor = currentActor();
      const isConfig = change.entity === "config";
      db.insert(changeLog)
        .values({
          entity: change.entity,
          entityId: change.entityId,
          action: change.action,
          before: isConfig ? redactConfigValue(change.entityId as ConfigKey, change.before) : change.before,
          after: isConfig ? redactConfigValue(change.entityId as ConfigKey, change.after) : change.after,
          source: change.source ?? actor.source,
          username: change.username ?? actor.username,
          timestamp: Date.now(),
        })
        .run();
    } catch (err) {
      log.error("failed to record a change", {
        entity: change.entity,
        entityId: change.entityId,
        err: errorMessage(err),
      });
    }
  }

  /**
   * The newest id per entity, so `restorable` can exclude the current state.
   *
   * One grouped query for the page rather than a lookup per row: a 100-row
   * global feed spanning 40 entities would otherwise be 40 round trips to
   * answer a question about a button's disabled attribute.
   */
  function newestIds(rows: { entity: string; entityId: string }[]): Set<string> {
    if (rows.length === 0) return new Set();
    const wanted = new Set(rows.map((r) => `${r.entity}\u0000${r.entityId}`));
    const newest = db
      .select({
        entity: changeLog.entity,
        entityId: changeLog.entityId,
        id: sql<number>`max(${changeLog.id})`,
      })
      .from(changeLog)
      .groupBy(changeLog.entity, changeLog.entityId)
      .all()
      .filter((r) => wanted.has(`${r.entity}\u0000${r.entityId}`));
    return new Set(newest.map((r) => String(r.id)));
  }

  function history(query: HistoryQuery = {}): HistoryEntry[] {
    const { entity, entityId, limit = 100, since } = query;

    const rows = db
      .select()
      .from(changeLog)
      .where(
        and(
          entity ? eq(changeLog.entity, entity) : undefined,
          entityId ? eq(changeLog.entityId, entityId) : undefined,
          since ? sql`${changeLog.timestamp} >= ${since}` : undefined,
        ),
      )
      .orderBy(desc(changeLog.timestamp), desc(changeLog.id))
      .limit(limit)
      .all();

    const current = newestIds(rows);

    return rows.map((row) => ({
      id: row.id,
      entity: row.entity as ChangeEntity,
      entityId: row.entityId,
      action: row.action as ChangeAction,
      source: row.source,
      username: row.username,
      timestamp: row.timestamp,
      before: row.before ?? null,
      after: row.after ?? null,
      // Only an edit has fields. A create has nothing to diff against, and
      // diffing it against `{}` produces a row claiming every field "changed"
      // from an empty object — which is technically true and reads as noise.
      // A delete is the same in reverse. Both render as a verb alone.
      fields: row.before == null || row.after == null ? [] : diffSnapshots(row.before, row.after),
      restorable: row.after != null && !current.has(String(row.id)),
    }));
  }

  /** One version, for the restore path to write back. */
  function snapshot(id: number): { entity: ChangeEntity; entityId: string; after: unknown } | undefined {
    const row = db.select().from(changeLog).where(eq(changeLog.id, id)).get();
    if (!row || row.after == null) return undefined;
    return { entity: row.entity as ChangeEntity, entityId: row.entityId, after: row.after };
  }

  /** Rows older than `cutoff`. Called from the nightly `purge-runs` sweep. */
  function pruneChangeLog(cutoff: number): number {
    return db.delete(changeLog).where(lt(changeLog.timestamp, cutoff)).run().changes;
  }

  return { record, history, snapshot, pruneChangeLog };
}

export type ConfigHistory = ReturnType<typeof createConfigHistory>;

export const ConfigHistoryToken = token<ConfigHistory>("domain.config-history");
