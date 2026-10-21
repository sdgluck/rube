/**
 * The only place user input becomes SQL in this codebase, twice over: once as
 * an FTS5 `MATCH` expression and once as a `LIKE` pattern.
 *
 * FTS5's MATCH is a query language, not a string. `"`, `*`, `^`, `-`, `NEAR`
 * and `:` all mean something, so a query containing any of them either changes
 * the search or fails with a syntax error the user cannot act on. `buildMatch`
 * defends by tokenizing to letters and numbers only — which is the right
 * approach, and was untested.
 *
 * The `LIKE` branch for prerolls escapes `%`, `_` and `\` and declares
 * `ESCAPE '\'`. Miss one and `%` in a query matches everything, which reads as
 * "search is broken" rather than as an injection, so nobody reports it.
 *
 * The searches themselves run against a real migrated database, because the
 * FTS triggers are what put anything in the index at all.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";

import { sql } from "drizzle-orm";
import { createTestContainer } from "@rube/composition/test-support";
import { DbToken, mediaItems, rules } from "@rube/db";
import { buildMatch, SearchToken } from "@rube/domain.search";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { searchAll } = c.resolve(SearchToken);

describe("buildMatch", () => {
  test("a single word becomes a prefix match", () => {
    assert.equal(buildMatch("nolan"), "nolan*");
  });

  test("several words are ANDed, each as a prefix", () => {
    assert.equal(buildMatch("blade runner"), "blade* runner*");
  });

  test("case is folded", () => {
    assert.equal(buildMatch("BLADE Runner"), "blade* runner*");
  });

  test("punctuation is a separator, not a token", () => {
    // Every one of these means something to FTS5 if it reaches the expression.
    assert.equal(buildMatch("sci-fi"), "sci* fi*");
    assert.equal(buildMatch("a.b,c"), "a* b* c*");
    assert.equal(buildMatch("who's there"), "who* s* there*");
  });

  test("FTS5 operators cannot reach the expression", () => {
    // The injection case. `"` would open a phrase, `-` negates, `^` anchors,
    // `NEAR` is a function, and a stray one produces a syntax error at best.
    assert.equal(buildMatch('"quoted"'), "quoted*");
    assert.equal(buildMatch("-excluded"), "excluded*");
    assert.equal(buildMatch("^anchored"), "anchored*");
    assert.equal(buildMatch("a AND b"), "a* and* b*", "AND is lower-cased into an ordinary token");
    assert.equal(buildMatch("col:value"), "col* value*");
    assert.equal(buildMatch("a*"), "a*", "a user's own star does not double up");
  });

  test("digits are kept", () => {
    assert.equal(buildMatch("blade runner 2049"), "blade* runner* 2049*");
    assert.equal(buildMatch("4K"), "4k*");
  });

  test("letters outside ASCII are kept", () => {
    // `\p{L}` rather than `a-z`: a library full of non-English titles would
    // otherwise be unsearchable.
    assert.equal(buildMatch("amélie"), "amélie*");
    assert.equal(buildMatch("千と千尋"), "千と千尋*");
    assert.equal(buildMatch("Волк"), "волк*");
  });

  test("a query with nothing searchable in it is null", () => {
    // Null short-circuits the whole search rather than running `MATCH ''`,
    // which is a syntax error.
    for (const query of ["", "   ", "!!!", "-", '""', "***"]) {
      assert.equal(buildMatch(query), null, JSON.stringify(query));
    }
  });

  test("runs of separators collapse rather than producing empty tokens", () => {
    // An empty token would emit a bare `*`, which FTS5 rejects.
    assert.equal(buildMatch("a   ---   b"), "a* b*");
    assert.equal(buildMatch("  leading and trailing  "), "leading* and* trailing*");
  });
});

describe("searchAll", () => {
  beforeEach(() => {
    db.delete(rules).run();
    db.delete(mediaItems).run();
    db.run(sql`DELETE FROM prerolls`);
  });

  function seedRule(id: string, name: string): void {
    db.insert(rules).values({ id, name, type: "collection", createdAt: 0 }).run();
  }

  function seedMedia(ratingKey: string, title: string): void {
    db.insert(mediaItems)
      .values({ ratingKey, title, sectionId: "1", sectionTitle: "Movies", type: "movie", syncedAt: 0 })
      .run();
  }

  test("finds a rule by a prefix of its name", () => {
    seedRule("r1", "Christopher Nolan");
    const hits = searchAll("nol");
    assert.deepEqual(
      hits.map((h) => h.id),
      ["r1"],
    );
    assert.equal(hits[0]?.kind, "rule");
  });

  test("all words must match, not any", () => {
    seedRule("r1", "Sci-Fi Gems");
    seedRule("r2", "Sci-Fi Classics");

    assert.deepEqual(
      searchAll("sci gems").map((h) => h.id),
      ["r1"],
    );
    assert.equal(searchAll("sci").length, 2);
  });

  test("a query that tokenizes to nothing returns nothing rather than everything", () => {
    // The failure this prevents: a null match falling through to an unfiltered
    // query, so typing `!` in the palette lists the entire library.
    seedRule("r1", "Anything");
    seedMedia("m1", "Anything");
    assert.deepEqual(searchAll("!!!"), []);
    assert.deepEqual(searchAll(""), []);
  });

  test("searches across kinds at once", () => {
    seedRule("r1", "Arrival Rule");
    seedMedia("m1", "Arrival");

    const kinds = new Set(searchAll("arrival").map((h) => h.kind));
    assert.ok(kinds.has("rule"));
    assert.ok(kinds.has("media"));
  });

  test("`kinds` narrows the sweep", () => {
    seedRule("r1", "Arrival Rule");
    seedMedia("m1", "Arrival");

    const hits = searchAll("arrival", 8, ["media"]);
    assert.deepEqual(new Set(hits.map((h) => h.kind)), new Set(["media"]));
  });

  test("an empty `kinds` means every kind", () => {
    seedRule("r1", "Arrival Rule");
    assert.equal(searchAll("arrival", 8, []).length, 1);
  });

  test("the limit is per kind, so a narrowed search returns that many of what you asked for", () => {
    for (let i = 0; i < 5; i++) {
      seedRule(`r${i}`, `Nolan ${i}`);
      seedMedia(`m${i}`, `Nolan ${i}`);
    }

    assert.equal(searchAll("nolan", 3, ["rule"]).length, 3);
    assert.equal(searchAll("nolan", 3).length, 6, "three of each kind that matched");
  });

  test("every hit carries a link", () => {
    seedRule("r1", "Nolan");
    seedMedia("m1", "Nolan");
    for (const hit of searchAll("nolan")) {
      assert.match(hit.href, /^\//, `${hit.kind} has no href`);
    }
  });
});

describe("the preroll LIKE branch", () => {
  beforeEach(() => {
    db.run(sql`DELETE FROM prerolls`);
  });

  function seedPreroll(id: string, name: string, originalFilename = name): void {
    db.run(
      sql`INSERT INTO prerolls (id, name, original_filename, status, position, created_at, updated_at)
          VALUES (${id}, ${name}, ${originalFilename}, 'ready', 0, 0, 0)`,
    );
  }

  test("matches a substring anywhere in the name", () => {
    seedPreroll("p1", "Summer Intro 2024");
    assert.deepEqual(
      searchAll("intro", 8, ["preroll"]).map((h) => h.id),
      ["p1"],
    );
  });

  test("matches the original filename too", () => {
    seedPreroll("p1", "Renamed", "original-clip.mp4");
    assert.equal(searchAll("clip", 8, ["preroll"]).length, 1);
  });

  test("a percent sign in the query is a literal, not a wildcard", () => {
    // Unescaped, `%` matches everything and the user concludes search is
    // broken rather than that they typed a wildcard.
    seedPreroll("p1", "Ordinary");
    seedPreroll("p2", "100% Beef");

    const hits = searchAll("100%", 8, ["preroll"]);
    assert.deepEqual(
      hits.map((h) => h.id),
      ["p2"],
    );
  });

  test("an underscore is a literal too", () => {
    seedPreroll("p1", "a_b");
    seedPreroll("p2", "axb");

    assert.deepEqual(
      searchAll("a_b", 8, ["preroll"]).map((h) => h.id),
      ["p1"],
      "`_` did not match the single character in axb",
    );
  });

  test("a backslash is a literal, and does not break the ESCAPE clause", () => {
    seedPreroll("p1", "back\\slash");
    seedPreroll("p2", "no slash");

    assert.deepEqual(
      searchAll("back\\slash", 8, ["preroll"]).map((h) => h.id),
      ["p1"],
    );
  });

  test("a bare wildcard query does not list every preroll", () => {
    seedPreroll("p1", "One");
    seedPreroll("p2", "Two");
    assert.deepEqual(searchAll("%", 8, ["preroll"]), []);
  });

  test("matching is case-insensitive", () => {
    seedPreroll("p1", "Summer Intro");
    assert.equal(searchAll("SUMMER", 8, ["preroll"]).length, 1);
  });
});
