/**
 * A bounded ring of the last few runs per rule+section, so the generate job can
 * avoid re-proposing a collection it recently built.
 *
 * The interesting part is the trim, which reads:
 *
 *     if (keep.length < MAX_RUNS_PER_SECTION) return;
 *     const cutoff = keep[keep.length - 1].runAt;
 *     delete ... where runAt < cutoff
 *
 * `<` rather than `<=`, and the cutoff is the *oldest kept* row — so anything
 * sharing that timestamp survives alongside it. `runAt` is `Date.now()`, and a
 * rule that syncs several sections in the same millisecond produces exactly
 * that tie. The bound is therefore "at least MAX", not "exactly MAX".
 *
 * That is a bounded-growth question rather than a correctness one — no user
 * data is lost either way — so this pins the behaviour instead of changing it.
 * The tie case is the one worth having written down, because it is the one a
 * reader of the code would get wrong.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { createTestContainer } from "@rube/composition/test-support";
import { DbToken, ruleHistory, rules } from "@rube/db";
import { RuleHistoryToken } from "@rube/domain.rule-history";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { getRecentHistory, appendHistory, clearHistory } = c.resolve(RuleHistoryToken);

const RULE = "rule-a";
const SECTION = "1";

function rows(ruleId = RULE) {
  return db.select().from(ruleHistory).where(eq(ruleHistory.ruleId, ruleId)).all();
}

/**
 * Append a run and force its `runAt`, because the module stamps `Date.now()`
 * and several appends in a test land in the same millisecond.
 */
function appendAt(runAt: number, name: string, sectionKey = SECTION, ruleId = RULE): void {
  db.insert(ruleHistory)
    .values({ ruleId, sectionKey, sectionTitle: "Movies", runAt, collections: [{ name, sampleItems: [name] }] })
    .run();
}

beforeEach(() => {
  db.delete(ruleHistory).run();
  db.delete(rules).run();
  for (const id of [RULE, "rule-b"]) {
    db.insert(rules).values({ id, name: id, type: "collection", createdAt: 0 }).run();
  }
});

describe("appendHistory", () => {
  test("records a run's collections", () => {
    appendHistory(RULE, SECTION, "Movies", [{ name: "Sci-Fi Gems", sampleItems: ["Arrival"] }]);

    assert.deepEqual(getRecentHistory(RULE, SECTION), [{ name: "Sci-Fi Gems", sampleItems: ["Arrival"] }]);
  });

  test("an empty run is not recorded at all", () => {
    // Nothing to remember, and a row of nothing would consume one of the ten
    // slots that exist to hold something.
    appendHistory(RULE, SECTION, "Movies", []);
    assert.equal(rows().length, 0);
  });

  test("flattens several runs into one list, newest first", () => {
    appendAt(300, "Third");
    appendAt(100, "First");
    appendAt(200, "Second");

    assert.deepEqual(
      getRecentHistory(RULE, SECTION).map((h) => h.name),
      ["Third", "Second", "First"],
    );
  });

  test("several collections in one run all come back", () => {
    appendHistory(RULE, SECTION, "Movies", [
      { name: "A", sampleItems: [] },
      { name: "B", sampleItems: [] },
    ]);

    assert.deepEqual(
      getRecentHistory(RULE, SECTION).map((h) => h.name),
      ["A", "B"],
    );
  });
});

describe("the trim", () => {
  test("keeps the ten most recent runs and drops the rest", () => {
    for (let i = 1; i <= 15; i++) appendAt(i * 1_000, `Run ${i}`);
    // The trim only runs inside `appendHistory`, so trigger it with a real one.
    appendHistory(RULE, SECTION, "Movies", [{ name: "Newest", sampleItems: [] }]);

    const kept = getRecentHistory(RULE, SECTION).map((h) => h.name);
    assert.equal(kept.length, 10);
    assert.equal(kept[0], "Newest");
    assert.equal(kept.at(-1), "Run 7", "everything older than the tenth-newest went");
  });

  test("does nothing while there are fewer than ten runs", () => {
    for (let i = 1; i <= 5; i++) appendAt(i * 1_000, `Run ${i}`);
    appendHistory(RULE, SECTION, "Movies", [{ name: "Sixth", sampleItems: [] }]);

    assert.equal(rows().length, 6);
  });

  test("rows sharing the oldest kept timestamp survive — the bound is at-least-ten", () => {
    // The `<` in `runAt < cutoff`, where the cutoff is the *oldest kept* row.
    // Arranged so the tie lands exactly on that boundary: the newest run plus
    // eight distinct ones fill nine of the ten slots, and the tenth is one of
    // five rows sharing a timestamp. The cutoff is therefore that shared value,
    // and `< cutoff` deletes none of them.
    //
    // Fourteen rows survive a trim that reads as though it keeps ten. Harmless
    // — it is bounded growth, not lost data — but not what the code says.
    for (let i = 1; i <= 8; i++) appendAt(12_000 + i * 1_000, `Recent ${i}`);
    for (let i = 0; i < 5; i++) appendAt(11_000, `Tied ${i}`);

    appendHistory(RULE, SECTION, "Movies", [{ name: "Newest", sampleItems: [] }]);

    assert.equal(rows().length, 14, "the five tied rows all survived alongside the cutoff");
  });

  test("trims per rule and section, not globally", () => {
    // The where-clause carries both. Without them, a busy rule would evict a
    // quiet one's history and the generate job would re-propose collections it
    // had just built.
    for (let i = 1; i <= 15; i++) appendAt(i * 1_000, `A ${i}`, SECTION, RULE);
    appendAt(1, "Other section", "2", RULE);
    appendAt(1, "Other rule", SECTION, "rule-b");

    appendHistory(RULE, SECTION, "Movies", [{ name: "Newest", sampleItems: [] }]);

    assert.equal(getRecentHistory(RULE, "2").length, 1, "the other section kept its run");
    assert.equal(getRecentHistory("rule-b", SECTION).length, 1, "the other rule kept its run");
  });
});

describe("getRecentHistory", () => {
  test("is scoped to one rule and section", () => {
    appendAt(100, "Mine", SECTION, RULE);
    appendAt(100, "Theirs", SECTION, "rule-b");
    appendAt(100, "Elsewhere", "2", RULE);

    assert.deepEqual(
      getRecentHistory(RULE, SECTION).map((h) => h.name),
      ["Mine"],
    );
  });

  test("an unknown rule or section is empty rather than an error", () => {
    assert.deepEqual(getRecentHistory("nobody", SECTION), []);
    assert.deepEqual(getRecentHistory(RULE, "999"), []);
  });
});

describe("clearHistory", () => {
  test("clears every section for one rule", () => {
    appendAt(100, "A", "1");
    appendAt(100, "B", "2");
    appendAt(100, "Other", "1", "rule-b");

    clearHistory(RULE);

    assert.equal(rows(RULE).length, 0);
    assert.equal(rows("rule-b").length, 1, "another rule's history is untouched");
  });

  test("clearing an unknown rule is a no-op", () => {
    appendAt(100, "A");
    clearHistory("nobody");
    assert.equal(rows().length, 1);
  });

  test("deleting the rule takes its history with it", () => {
    appendAt(100, "A");
    db.delete(rules).where(eq(rules.id, RULE)).run();
    assert.equal(rows().length, 0);
  });
});
