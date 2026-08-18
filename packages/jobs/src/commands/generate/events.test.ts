/**
 * Both of these events are transitions, and the value of a transition event is
 * entirely in *not* firing the rest of the time. A `rule.empty` that fired
 * every night for a rule that has been dead for a month is indistinguishable
 * from noise, and a `collection.created` that fired for every collection a run
 * committed would fire for all of them every night — a run touches every
 * collection it owns whether or not anything about it changed.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-generate-events-test-");

const { db, events } = await import("@tinkerbell/db");
const { announceEmptyRule, announceNewCollections } = await import("./events.ts");

const RULE = "rule-1";
const NAME = "Best of the 80s";

function emitted(type: string) {
  return db
    .select()
    .from(events)
    .all()
    .filter((e) => e.type === type);
}

beforeEach(() => {
  db.delete(events).run();
});

describe("rule.empty", () => {
  test("fires when a rule that matched something now matches nothing", () => {
    announceEmptyRule(RULE, NAME, 42, 0);
    const fired = emitted("rule.empty");
    assert.equal(fired.length, 1);
    assert.match(fired[0].message, /matched nothing/);
    assert.match(fired[0].message, /42/);
  });

  test("does not fire again on the next equally empty run", () => {
    announceEmptyRule(RULE, NAME, 42, 0);
    // The second run's "previous" count is the zero the first run recorded.
    announceEmptyRule(RULE, NAME, 0, 0);
    assert.equal(emitted("rule.empty").length, 1, "a rule that is still dead is not news");
  });

  test("does not fire for a rule that is still matching", () => {
    announceEmptyRule(RULE, NAME, 42, 40);
    assert.equal(emitted("rule.empty").length, 0);
  });

  test("does not fire for a rule that has never matched anything", () => {
    // A brand-new rule, or one that has never worked. Its first run isn't a
    // regression, and reporting it would mean every misconfigured rule
    // announced itself as having broken.
    announceEmptyRule(RULE, NAME, null, 0);
    assert.equal(emitted("rule.empty").length, 0);
  });

  test("fires again once the rule recovers and dies a second time", () => {
    announceEmptyRule(RULE, NAME, 42, 0);
    announceEmptyRule(RULE, NAME, 0, 12);
    announceEmptyRule(RULE, NAME, 12, 0);
    assert.equal(emitted("rule.empty").length, 2);
  });
});

describe("collection.created", () => {
  test("fires only for names that weren't there before the run", () => {
    announceNewCollections(RULE, NAME, ["Old Shelf"], ["Old Shelf", "New Shelf"]);
    const fired = emitted("collection.created");
    assert.equal(fired.length, 1);
    assert.match(fired[0].message, /New Shelf/);
    assert.doesNotMatch(fired[0].message, /Old Shelf/);
  });

  test("stays silent when a run recreates exactly what was there", () => {
    announceNewCollections(RULE, NAME, ["A", "B"], ["B", "A"]);
    assert.equal(emitted("collection.created").length, 0, "committing a collection again is not creation");
  });

  test("stays silent when a run produces nothing", () => {
    announceNewCollections(RULE, NAME, ["A"], []);
    assert.equal(emitted("collection.created").length, 0);
  });

  test("a rule's first ever run announces everything it built", () => {
    announceNewCollections(RULE, NAME, [], ["A", "B", "C"]);
    const fired = emitted("collection.created");
    assert.equal(fired.length, 1);
    assert.equal((fired[0].metadata as { count: number }).count, 3);
  });

  test("many new collections are one event with a sample, not one event each", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Shelf ${i}`);
    announceNewCollections(RULE, NAME, [], many);
    const fired = emitted("collection.created");
    assert.equal(fired.length, 1);
    assert.match(fired[0].message, /and 35 more/);
    assert.equal((fired[0].metadata as { titles: string[] }).titles.length, 5);
  });
});
