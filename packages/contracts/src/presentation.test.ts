/**
 * The summary is written straight into somebody's Plex server, so the property
 * that matters most is the negative one: a rule type with nothing honest to
 * say must produce *nothing*, never a half-built sentence.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RULE_TYPE_VALUES } from "./rule-config.ts";
import {
  DEFAULT_PRESENTATION,
  POSTER_URL_ALLOWED_HOSTS,
  posterUrlRejection,
  presentationConfigSchema,
  resolveCollectionSummary,
  resolvePosterTemplate,
  resolvePresentation,
  templatedCollectionSummary,
} from "./presentation.ts";

describe("templatedCollectionSummary", () => {
  it("names the thing the collection is about, per grouped rule type", () => {
    const cases: Array<[string, string, string]> = [
      ["directors", "Christopher Nolan", "Films directed by Christopher Nolan."],
      ["actors", "Cate Blanchett", "Films starring Cate Blanchett."],
      ["studios", "A24", "Films produced by A24."],
      ["content_ratings", "R", "Films rated R."],
      ["decades", "1980s", "Films released between 1980 and 1989."],
      ["years", "1994", "Films released in 1994."],
      ["resolutions", "4K", "Films available in 4K."],
      ["audio_languages", "Japanese", "Films with Japanese audio."],
      ["based_on", "Based on a Novel", "Films based on a novel."],
    ];
    for (const [ruleType, collectionName, expected] of cases) {
      assert.equal(
        templatedCollectionSummary({ ruleType, collectionName, sectionType: "movie" }),
        expected,
        `${ruleType} / ${collectionName}`,
      );
    }
  });

  it("says series in a TV library and titles in anything else", () => {
    assert.equal(
      templatedCollectionSummary({ ruleType: "networks", collectionName: "HBO", sectionType: "show" }),
      "Series that aired on HBO.",
    );
    assert.equal(
      templatedCollectionSummary({ ruleType: "networks", collectionName: "HBO", sectionType: "artist" }),
      "Titles that aired on HBO.",
    );
  });

  it("produces nothing — never a broken string — for an unknown rule type", () => {
    assert.equal(templatedCollectionSummary({ ruleType: "not_a_rule_type", collectionName: "Whatever" }), null);
  });

  it("produces nothing for an empty collection name", () => {
    assert.equal(templatedCollectionSummary({ ruleType: "directors", collectionName: "   " }), null);
  });

  it("gives ai_prompt no template — its titles are already its description", () => {
    assert.equal(templatedCollectionSummary({ ruleType: "ai_prompt", collectionName: "Slow Burn Thrillers" }), null);
  });

  it("prefers a summary the source published over any template", () => {
    assert.equal(
      templatedCollectionSummary({
        ruleType: "tmdb_franchises",
        collectionName: "The Matrix Collection",
        sourceSummary: "A cycle of films about a simulated reality.",
      }),
      "A cycle of films about a simulated reality.",
    );
  });

  it("reads a smart filter back as English, and says nothing without one", () => {
    const withFilter = templatedCollectionSummary({
      ruleType: "smart_filter",
      collectionName: "Modern Horror",
      sectionType: "movie",
      config: {
        smartFilter: {
          kind: "group",
          combinator: "all",
          children: [
            { kind: "leaf", field: "genre", op: "=", value: "Horror" },
            { kind: "leaf", field: "year", op: ">=", value: "2000" },
          ],
        },
      },
    });
    assert.equal(withFilter, "Horror films from 2000 onwards.");
    assert.equal(templatedCollectionSummary({ ruleType: "smart_filter", collectionName: "Modern Horror" }), null);
  });

  it("restates a filter it can't turn into prose, rather than guessing at one", () => {
    // A top-level `or` across two fields: no sentence means the same thing.
    const text = templatedCollectionSummary({
      ruleType: "smart_filter",
      collectionName: "Mixed",
      sectionType: "movie",
      config: {
        smartFilter: {
          kind: "group",
          combinator: "any",
          children: [
            { kind: "leaf", field: "genre", op: "=", value: "1204" },
            { kind: "leaf", field: "addedAt", op: ">=", value: "-7d" },
          ],
        },
      },
      resolveTag: (_field, value) => (value === "1204" ? "Horror" : value),
    });
    assert.equal(text, "Films matching genre is Horror or date added in the last 7 days.");
  });

  it("never returns a string containing an obvious hole", () => {
    // Every real rule type, with a plausible name — nothing may come back
    // with a doubled space, a dangling preposition, or an empty quotation.
    for (const ruleType of RULE_TYPE_VALUES) {
      const text = templatedCollectionSummary({ ruleType, collectionName: "Example", sectionType: "movie" });
      if (text === null) continue;
      assert.ok(!/\s{2}/.test(text), `${ruleType}: doubled space in "${text}"`);
      assert.ok(!/\s[.]/.test(text), `${ruleType}: space before the full stop in "${text}"`);
      assert.ok(text.endsWith("."), `${ruleType}: no full stop in "${text}"`);
    }
  });
});

describe("resolveCollectionSummary", () => {
  it("writes nothing when summaries are switched off", () => {
    assert.equal(
      resolveCollectionSummary(
        { summary: "none", poster: "none" },
        { ruleType: "directors", collectionName: "Christopher Nolan" },
      ),
      null,
    );
  });

  it("uses the custom text verbatim, and falls through when it is blank", () => {
    const context = { ruleType: "directors", collectionName: "Christopher Nolan" };
    assert.deepEqual(
      resolveCollectionSummary({ summary: "custom", customSummary: "  Hand written.  ", poster: "none" }, context),
      { text: "Hand written.", source: "custom" },
    );
    assert.equal(resolveCollectionSummary({ summary: "custom", customSummary: "   ", poster: "none" }, context), null);
  });

  it("gives the llm source the template as its fallback", () => {
    // The LLM call happens later, in `collection-art`. Until it does — or if no
    // provider is ever configured — the collection still gets a description.
    assert.deepEqual(
      resolveCollectionSummary(
        { summary: "llm", poster: "none" },
        { ruleType: "directors", collectionName: "Christopher Nolan", sectionType: "movie" },
      ),
      { text: "Films directed by Christopher Nolan.", source: "template" },
    );
  });
});

describe("resolvePresentation", () => {
  it("treats a rule with no presentation block as template summary, no poster", () => {
    assert.deepEqual(resolvePresentation(undefined), DEFAULT_PRESENTATION);
    assert.deepEqual(resolvePresentation({}), DEFAULT_PRESENTATION);
    assert.equal(DEFAULT_PRESENTATION.poster, "none");
  });
});

describe("resolvePosterTemplate", () => {
  it("picks a mosaic that the available art can actually fill", () => {
    assert.equal(resolvePosterTemplate("mosaic", 0), "mosaic-2x2");
    assert.equal(resolvePosterTemplate("mosaic", 5), "mosaic-2x2");
    assert.equal(resolvePosterTemplate("mosaic", 6), "mosaic-3x2");
  });

  it("is deterministic — same inputs, same template", () => {
    for (let i = 0; i < 12; i++) {
      assert.equal(resolvePosterTemplate("mosaic", i), resolvePosterTemplate("mosaic", i));
    }
  });
});

describe("posterUrlRejection", () => {
  it("accepts HTTPS on an allow-listed host", () => {
    for (const host of POSTER_URL_ALLOWED_HOSTS) {
      assert.equal(posterUrlRejection(`https://${host}/a/b.jpg`), null, host);
    }
  });

  it("rejects plaintext HTTP", () => {
    assert.equal(posterUrlRejection("http://raw.githubusercontent.com/a.jpg"), "not-https");
  });

  it("rejects a host nobody vetted", () => {
    assert.equal(posterUrlRejection("https://example.com/a.jpg"), "host-not-allowed");
  });

  it("is not fooled by an allow-listed host in the wrong position", () => {
    assert.equal(posterUrlRejection("https://evil.com/raw.githubusercontent.com/a.jpg"), "host-not-allowed");
    assert.equal(posterUrlRejection("https://raw.githubusercontent.com.evil.com/a.jpg"), "host-not-allowed");
    assert.equal(posterUrlRejection("https://user@evil.com/a.jpg"), "host-not-allowed");
  });

  it("rejects non-URLs and non-HTTP schemes", () => {
    assert.equal(posterUrlRejection("not a url"), "not-a-url");
    assert.equal(posterUrlRejection("file:///etc/passwd"), "not-https");
    assert.equal(posterUrlRejection("data:image/png;base64,AAAA"), "not-https");
  });
});

describe("presentationConfigSchema", () => {
  it("defaults to a templated summary and no artwork", () => {
    assert.deepEqual(presentationConfigSchema.parse({}), DEFAULT_PRESENTATION);
  });

  it("refuses a url poster whose URL would be fetched from anywhere", () => {
    const bad = presentationConfigSchema.safeParse({ poster: "url", posterUrl: "http://example.com/x.jpg" });
    assert.equal(bad.success, false);
  });

  it("refuses a url poster with no URL at all", () => {
    assert.equal(presentationConfigSchema.safeParse({ poster: "url" }).success, false);
  });

  it("refuses a custom summary with nothing written in it", () => {
    assert.equal(presentationConfigSchema.safeParse({ summary: "custom", customSummary: "  " }).success, false);
  });

  it("refuses an accent that isn't a hex colour", () => {
    assert.equal(presentationConfigSchema.safeParse({ accentColor: "goldish" }).success, false);
    assert.equal(presentationConfigSchema.safeParse({ accentColor: "#E5A00D" }).success, true);
  });
});
