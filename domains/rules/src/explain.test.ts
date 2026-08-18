/**
 * The explainer's job is to be right about *why*, which means the verdict and
 * the per-clause breakdown have to agree with each other and with the way the
 * generate handler actually combines things: the Plex half follows the tree's
 * combinator, the local (watch-state) half is always AND'd on top.
 *
 * A fake client here rather than a real one: what is under test is the
 * combining, and the query construction is exercised by asserting on the
 * paths the fake is asked for.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-rules-explain-test-");

const { db, watchState } = await import("@tinkerbell/db");
const { explainItem } = await import("./explain.ts");

const SECTIONS = [
  { key: "1", title: "Movies", type: "movie" },
  { key: "2", title: "TV Shows", type: "show" },
];

const ITEM = "100";

/**
 * A client that answers each branch query with whichever rating keys the test
 * says that branch matches, keyed by a fragment of the emitted query.
 */
function fakeClient(matchesByFragment: Record<string, string[]>, sectionId = "1") {
  const asked: string[] = [];
  const client = {
    async getItemFields() {
      return { ratingKey: ITEM, title: "The Quiet Antenna", type: "movie", sectionId, sectionType: "movie" };
    },
    async fetchItemsByFilter(path: string) {
      asked.push(path);
      for (const [fragment, keys] of Object.entries(matchesByFragment)) {
        if (path.includes(fragment)) return keys.map((ratingKey) => ({ ratingKey, title: "x" }));
      }
      return [];
    },
  };
  return { client: client as never, asked };
}

const leaf = (field: string, op: string, value: string) => ({ kind: "leaf" as const, field, op, value });

const group = (combinator: "all" | "any", children: unknown[]) => ({
  kind: "group" as const,
  combinator,
  children: children as never,
});

beforeEach(() => {
  db.delete(watchState).run();
});

describe("explainItem", () => {
  test("an AND rule matches only when every clause passes", async () => {
    const { client } = fakeClient({ genre: [ITEM], year: [ITEM] });
    const result = await explainItem({
      client,
      ratingKey: ITEM,
      filter: group("all", [leaf("genre", "=", "Horror"), leaf("year", ">>=", "2000")]) as never,
      ruleSectionTitles: [],
      sections: SECTIONS,
    });
    assert.equal(result.matches, true);
    assert.equal(result.clauses.length, 2);
    assert.ok(result.clauses.every((c) => c.passed));
  });

  test("an AND rule fails on one failing clause, and names it", async () => {
    const { client } = fakeClient({ genre: [ITEM], year: ["999"] });
    const result = await explainItem({
      client,
      ratingKey: ITEM,
      filter: group("all", [leaf("genre", "=", "Horror"), leaf("year", ">>=", "2000")]) as never,
      ruleSectionTitles: [],
      sections: SECTIONS,
    });
    assert.equal(result.matches, false);
    assert.equal(result.clauses.filter((c) => !c.passed).length, 1);
    assert.match(result.clauses.find((c) => !c.passed)!.label, /year/i);
  });

  test("an OR rule matches on one passing clause", async () => {
    const { client } = fakeClient({ genre: ["999"], year: [ITEM] });
    const result = await explainItem({
      client,
      ratingKey: ITEM,
      filter: group("any", [leaf("genre", "=", "Horror"), leaf("year", ">>=", "2000")]) as never,
      ruleSectionTitles: [],
      sections: SECTIONS,
    });
    assert.equal(result.matches, true);
    assert.equal(result.combinator, "any");
  });

  test("an OR rule fails only when every clause fails", async () => {
    const { client } = fakeClient({});
    const result = await explainItem({
      client,
      ratingKey: ITEM,
      filter: group("any", [leaf("genre", "=", "Horror"), leaf("year", ">>=", "2000")]) as never,
      ruleSectionTitles: [],
      sections: SECTIONS,
    });
    assert.equal(result.matches, false);
  });

  test("a library the rule doesn't cover is answered before any clause is run", async () => {
    const { client, asked } = fakeClient({ genre: [ITEM] }, "2");
    const result = await explainItem({
      client,
      ratingKey: ITEM,
      filter: group("all", [leaf("genre", "=", "Horror")]) as never,
      ruleSectionTitles: ["Movies"],
      sections: SECTIONS,
    });
    assert.equal(result.matches, false);
    assert.match(result.reason ?? "", /only covers Movies/);
    // The point of answering early: no Plex round trips at all.
    assert.equal(asked.length, 0);
  });

  test("a rule scoped by section key covers that library, as the engine says it does", async () => {
    // The engine matches a section by lower-cased title *or* by key, and both
    // are legal in a saved config — migration and hand-written rules use keys.
    // This panel compared titles exactly, so it confidently told the user a rule
    // did not cover a library the run had just processed.
    const { client, asked } = fakeClient({ genre: [ITEM] }, "1");
    const result = await explainItem({
      client,
      ratingKey: ITEM,
      filter: group("all", [leaf("genre", "=", "Horror")]) as never,
      ruleSectionTitles: ["1", "2"],
      sections: SECTIONS,
    });
    assert.equal(result.matches, true, "in scope, so the clauses actually run");
    assert.ok(asked.length > 0);
  });

  test("case and padding don't put an item out of scope either", async () => {
    const { client } = fakeClient({ genre: [ITEM] }, "1");
    const result = await explainItem({
      client,
      ratingKey: ITEM,
      filter: group("all", [leaf("genre", "=", "Horror")]) as never,
      ruleSectionTitles: [" movies "],
      sections: SECTIONS,
    });
    assert.equal(result.matches, true);
  });

  test("a rule with no clauses matches everything in its libraries", async () => {
    const { client } = fakeClient({});
    const result = await explainItem({
      client,
      ratingKey: ITEM,
      filter: group("all", []) as never,
      ruleSectionTitles: [],
      sections: SECTIONS,
    });
    assert.equal(result.matches, true);
    assert.match(result.reason ?? "", /no filter/);
  });

  test("each clause is asked for on its own, narrowed by the item's title", async () => {
    // One query per clause, each carrying the title constraint that keeps the
    // response small enough to check membership in.
    const { client, asked } = fakeClient({ genre: [ITEM], year: [ITEM] });
    await explainItem({
      client,
      ratingKey: ITEM,
      filter: group("all", [leaf("genre", "=", "Horror"), leaf("year", ">>=", "2000")]) as never,
      ruleSectionTitles: [],
      sections: SECTIONS,
    });
    assert.equal(asked.length, 2);
    for (const path of asked) {
      assert.match(path, /title=The%20Quiet%20Antenna/);
      assert.match(path, /^\/library\/sections\/1\/all\?/);
    }
  });

  test("membership is decided on the rating key, not the title", async () => {
    // Two films share a title; only one of them is the item being explained.
    const { client } = fakeClient({ genre: ["777"] });
    const result = await explainItem({
      client,
      ratingKey: ITEM,
      filter: group("all", [leaf("genre", "=", "Horror")]) as never,
      ruleSectionTitles: [],
      sections: SECTIONS,
    });
    assert.equal(result.matches, false);
  });
});
