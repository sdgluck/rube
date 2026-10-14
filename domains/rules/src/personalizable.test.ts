/**
 * `setPersonalizable` can run across every rule, so the properties that matter are about the rules it
 * must *not* touch — a cleanup rule run once per user would be run per user at
 * all — and about each edit staying individually visible in history.
 */
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { changeLog, DbToken, rules } from "@tinkerbell/db";
import { RulesToken } from "@tinkerbell/domain.rules";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { setPersonalizable, getRule } = c.resolve(RulesToken);

function seed(id: string, config: Record<string, unknown>): void {
  db.insert(rules).values({ id, name: id, type: "smart_filter", config, enabled: 1, createdAt: 0 }).run();
}

const personalizable = (id: string) =>
  (getRule(id)?.config as { personalizable?: boolean } | undefined)?.personalizable;
const historyFor = (id: string) =>
  db
    .select()
    .from(changeLog)
    .where(and(eq(changeLog.entity, "rule"), eq(changeLog.entityId, id)))
    .all();

beforeEach(() => {
  db.delete(rules).run();
  db.delete(changeLog).run();
  seed("plain", {});
  seed("collection", { action: { kind: "collection" } });
  seed("cleanup", { action: { kind: "cleanup", mode: "delete", consecutiveRuns: 3 } });
  seed("playlist", { action: { kind: "playlist" } });
  seed("already", { personalizable: true });
});

describe("setPersonalizable", () => {
  test("marks every collection rule and nothing else", () => {
    const result = setPersonalizable("all-eligible", true);

    assert.equal(personalizable("plain"), true, "no action means a collection");
    assert.equal(personalizable("collection"), true);
    assert.equal(personalizable("cleanup"), undefined);
    assert.equal(personalizable("playlist"), undefined);
    assert.deepEqual(result, { changed: 2, skipped: 0 }, "the one already marked is not a change");
  });

  test("records one history entry per rule it changed", () => {
    setPersonalizable("all-eligible", true);
    assert.equal(historyFor("plain").length, 1);
    assert.equal(historyFor("already").length, 0);
    assert.equal(historyFor("cleanup").length, 0);
  });

  test("is idempotent", () => {
    setPersonalizable("all-eligible", true);
    assert.deepEqual(setPersonalizable("all-eligible", true), { changed: 0, skipped: 0 });
  });

  test("by id, skips the ineligible and the missing rather than refusing", () => {
    const result = setPersonalizable(["plain", "cleanup", "gone"], true);
    assert.deepEqual(result, { changed: 1, skipped: 2 });
    assert.equal(personalizable("plain"), true);
  });

  test("switching off leaves the rule as if it was never marked", () => {
    setPersonalizable(["already"], false);
    assert.equal("personalizable" in (getRule("already")?.config ?? {}), false);
  });
});
