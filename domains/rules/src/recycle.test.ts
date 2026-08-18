/**
 * Undo has to put a rule back where it was, not merely back.
 *
 * `position` decides which rule wins where two disagree — same collection name,
 * same metadata field — so a restore that dropped it silently promoted the rule
 * to the front of the running order, where it now won every conflict it used to
 * lose. That is a change nobody asked for, made by a button labelled "Undo".
 */
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { DbToken } from "@tinkerbell/db";
import { deletedRules, rules } from "@tinkerbell/db";
import { RulesToken } from "@tinkerbell/domain.rules";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { rememberDeletedRule, restoreDeletedRules, listDeletedRules } = c.resolve(RulesToken);

const T0 = 1_700_000_000_000;

function seed(id: string, position: number): void {
  db.insert(rules)
    .values({ id, name: id, type: "smart_filter", config: {}, enabled: 1, position, createdAt: T0 })
    .run();
}

function positionOf(id: string): number | undefined {
  return db.select().from(rules).where(eq(rules.id, id)).get()?.position;
}

beforeEach(() => {
  db.delete(deletedRules).run();
  db.delete(rules).run();
});

describe("restoreDeletedRules", () => {
  test("puts the rule back at the position it had", () => {
    seed("last", 12);
    rememberDeletedRule("last");
    db.delete(rules).where(eq(rules.id, "last")).run();

    const { restored, missing } = restoreDeletedRules(["last"]);
    assert.deepEqual(missing, []);
    assert.equal(restored.length, 1);
    assert.equal(positionOf("last"), 12, "restored to the back of the order, not the front");
  });

  test("a tombstone written before the column existed restores at the default", () => {
    // Null position is "no better answer than the default" — not an error, and
    // not a reason to refuse the restore.
    seed("old", 7);
    rememberDeletedRule("old");
    db.update(deletedRules).set({ position: null }).where(eq(deletedRules.id, "old")).run();
    db.delete(rules).where(eq(rules.id, "old")).run();

    restoreDeletedRules(["old"]);
    assert.equal(positionOf("old"), 0);
  });

  test("re-deleting a restored rule keeps its current position on the tombstone", () => {
    seed("moved", 3);
    rememberDeletedRule("moved");
    // Moved while it sat in the bin, then deleted again.
    db.update(rules).set({ position: 9 }).where(eq(rules.id, "moved")).run();
    rememberDeletedRule("moved");
    db.delete(rules).where(eq(rules.id, "moved")).run();

    assert.equal(listDeletedRules().length, 1);
    restoreDeletedRules(["moved"]);
    assert.equal(positionOf("moved"), 9);
  });
});
