/**
 * A short window in which a deleted rule can be put back.
 *
 * Deleting a rule was a confirmation dialog and then nothing — and a smart
 * filter is the most expensive thing in the app to lose, because it is an hour
 * of somebody's composition rather than a setting they can retype. The dialog
 * is the wrong protection anyway: a prompt you see on every delete is a prompt
 * you stop reading.
 *
 * Deliberately narrow. This restores the *rule*, not the state around it:
 *
 * - Its collections in Plex were deleted by the delete and are not recreated
 *   here. The next run rebuilds them, and the restore says so.
 * - Its run history is gone: `rule_runs` cascades on the foreign key, and
 *   resurrecting it would mean holding the rows somewhere for the same window
 *   to answer a question nobody asks about a rule they just un-deleted.
 *
 * Entries expire, because this is an undo rather than a recycle bin — an
 * offer good for as long as the sentence offering it is still on screen, plus
 * enough slack to change your mind.
 */

import { desc, eq, inArray, lt } from "drizzle-orm";
import { deletedRules, rules, type Db } from "@rube/db";
import { DAY_MS } from "@rube/core";
import type { Rule } from "./index.ts";

/**
 * How long a deleted rule can be restored for.
 *
 * A day rather than an hour: "I deleted the wrong one" is often noticed the
 * next time somebody opens the page, not in the ten seconds after the toast.
 */
export const RESTORE_WINDOW_MS = DAY_MS;

export interface DeletedRuleSummary {
  id: string;
  name: string;
  type: string;
  deletedAt: number;
}

export interface RecycleDeps {
  db: Db;
}
export function createRecycle(deps: RecycleDeps) {
  const { db } = deps;

  /**
   * Copy a rule into the recycle bin. Call *before* deleting it — this reads the
   * row it is preserving.
   *
   * Returns false when there was no such rule, so the caller can tell "deleted"
   * from "was never there" without a second query.
   */
  function rememberDeletedRule(id: string): boolean {
    const rule = db.select().from(rules).where(eq(rules.id, id)).get();
    if (!rule) return false;

    db.insert(deletedRules)
      .values({
        id: rule.id,
        name: rule.name,
        type: rule.type,
        config: rule.config,
        enabled: rule.enabled,
        createdAt: rule.createdAt,
        // Position decides which rule wins where two disagree, so it is part of
        // what a restore has to put back — see the column's note on the schema.
        position: rule.position,
        registryRuleSlug: rule.registryRuleSlug,
        registryPackSlug: rule.registryPackSlug,
        registryVersion: rule.registryVersion,
        registryConfigHash: rule.registryConfigHash,
        deletedAt: Date.now(),
      })
      // Deleting, restoring and deleting the same rule again is ordinary use;
      // the second delete overwrites the first tombstone rather than failing.
      .onConflictDoUpdate({
        target: deletedRules.id,
        set: {
          name: rule.name,
          type: rule.type,
          config: rule.config,
          enabled: rule.enabled,
          position: rule.position,
          deletedAt: Date.now(),
        },
      })
      .run();
    return true;
  }

  /**
   * Put deleted rules back, and report which ones could be.
   *
   * Partial success is the expected case rather than an error: a bulk undo of
   * twelve rules where one has expired should restore eleven and say so.
   */
  function restoreDeletedRules(ids: readonly string[]): { restored: Rule[]; missing: string[] } {
    if (ids.length === 0) return { restored: [], missing: [] };

    const cutoff = Date.now() - RESTORE_WINDOW_MS;
    const rows = db
      .select()
      .from(deletedRules)
      .where(inArray(deletedRules.id, [...ids]))
      .all()
      .filter((row) => row.deletedAt >= cutoff);

    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    if (rows.length === 0) return { restored: [], missing };

    const restored: Rule[] = [];
    db.transaction((tx) => {
      for (const row of rows) {
        tx.insert(rules)
          .values({
            id: row.id,
            name: row.name,
            type: row.type,
            config: row.config,
            enabled: row.enabled,
            createdAt: row.createdAt,
            // Null on a tombstone written before the column existed; the table
            // default (0, i.e. "ties with everything") is the honest answer then.
            ...(row.position == null ? {} : { position: row.position }),
            registryRuleSlug: row.registryRuleSlug,
            registryPackSlug: row.registryPackSlug,
            registryVersion: row.registryVersion,
            registryConfigHash: row.registryConfigHash,
          })
          // A rule already back under this id — restored twice, or recreated by
          // hand in the meantime — is left exactly as it is. Overwriting it
          // would make "undo" destroy something newer than what it restores.
          .onConflictDoNothing()
          .run();
        tx.delete(deletedRules).where(eq(deletedRules.id, row.id)).run();
      }
    });

    for (const row of rows) {
      const rule = db.select().from(rules).where(eq(rules.id, row.id)).get();
      if (rule) restored.push(rule);
    }
    return { restored, missing };
  }

  /** What's currently restorable, newest first. */
  function listDeletedRules(): DeletedRuleSummary[] {
    const cutoff = Date.now() - RESTORE_WINDOW_MS;
    return db
      .select({
        id: deletedRules.id,
        name: deletedRules.name,
        type: deletedRules.type,
        deletedAt: deletedRules.deletedAt,
      })
      .from(deletedRules)
      .orderBy(desc(deletedRules.deletedAt))
      .all()
      .filter((row) => row.deletedAt >= cutoff);
  }

  /** Drop tombstones past the window. Called by the purge job. */
  function pruneDeletedRules(): number {
    const result = db
      .delete(deletedRules)
      .where(lt(deletedRules.deletedAt, Date.now() - RESTORE_WINDOW_MS))
      .run();
    return result.changes ?? 0;
  }

  return { rememberDeletedRule, restoreDeletedRules, listDeletedRules, pruneDeletedRules };
}
