/**
 * The expander runs once per item per field over thousands of items, and its
 * output is written to somebody's library. Two properties matter more than the
 * rest: an unknown token is an error rather than a literal, and
 * `{sortableTitle}` only touches the languages it was told about.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_SORT_LANGUAGES,
  expandTemplate,
  METADATA_TOKENS,
  sortableTitle,
  templateError,
  unknownTokens,
} from "./metadata-tokens.ts";

describe("sortableTitle", () => {
  test("moves a leading English article to the end", () => {
    assert.equal(sortableTitle("The Matrix"), "Matrix, The");
    assert.equal(sortableTitle("A Serious Man"), "Serious Man, A");
    assert.equal(sortableTitle("An Education"), "Education, An");
  });

  test("leaves a title with no leading article alone", () => {
    assert.equal(sortableTitle("Blade Runner"), "Blade Runner");
  });

  test("is case-insensitive about the article but preserves its casing", () => {
    assert.equal(sortableTitle("THE Matrix"), "Matrix, THE");
  });

  test("leaves other languages' articles alone by default", () => {
    // Stripping "La" from "La Bamba" in an English library is exactly the
    // damage the opt-in language list exists to prevent.
    assert.equal(sortableTitle("La Bamba"), "La Bamba");
    assert.equal(sortableTitle("La Bamba", ["en", "es"]), "Bamba, La");
  });

  test("handles an apostrophe article, which carries no following space", () => {
    assert.equal(sortableTitle("L'Avventura", ["fr"]), "Avventura, L'");
  });

  test("leaves a title that is only an article alone", () => {
    // ", The" is not a sort title.
    assert.equal(sortableTitle("The"), "The");
    assert.equal(sortableTitle("The "), "The");
  });

  test("ignores an unrecognised language rather than throwing", () => {
    // A typo in a language list must not stop a rule from running.
    assert.equal(sortableTitle("The Matrix", ["klingon"]), "The Matrix");
  });

  test("defaults to English", () => {
    assert.deepEqual(DEFAULT_SORT_LANGUAGES, ["en"]);
  });
});

describe("unknownTokens / templateError", () => {
  test("accepts every documented token", () => {
    const template = METADATA_TOKENS.map((t) => `{${t}}`).join(" ");
    assert.deepEqual(unknownTokens(template), []);
    assert.equal(templateError(template), null);
  });

  test("names the token it does not know", () => {
    assert.deepEqual(unknownTokens("Marvel {titel}"), ["titel"]);
    assert.match(templateError("Marvel {titel}")!, /\{titel\}/);
  });

  test("reports every unknown token at once", () => {
    const error = templateError("{a} {b} {title}")!;
    assert.match(error, /\{a\}/);
    assert.match(error, /\{b\}/);
    assert.match(error, /Unknown tokens/);
  });

  test("passes a template with no tokens at all", () => {
    assert.equal(templateError("PG-13"), null);
  });
});

describe("expandTemplate", () => {
  const ctx = { title: "The Matrix", year: 1999, collection: "Marvel", studio: "Warner Bros." };

  test("expands every token", () => {
    assert.equal(expandTemplate("{title}", ctx), "The Matrix");
    assert.equal(expandTemplate("{year}", ctx), "1999");
    assert.equal(expandTemplate("{sortableTitle}", ctx), "Matrix, The");
    assert.equal(expandTemplate("{collection}", ctx), "Marvel");
    assert.equal(expandTemplate("{studio}", ctx), "Warner Bros.");
  });

  test("expands several tokens in one template", () => {
    assert.equal(expandTemplate("{collection} {year} {sortableTitle}", ctx), "Marvel 1999 Matrix, The");
  });

  test("keeps literal text around the tokens", () => {
    assert.equal(expandTemplate("Marvel: {title} ({year})", ctx), "Marvel: The Matrix (1999)");
  });

  test("collapses the gap a missing value leaves behind", () => {
    // "Marvel  Iron Man" reads as a bug; "Marvel Iron Man" reads as a title.
    assert.equal(
      expandTemplate("{collection} {year} {title}", { title: "Iron Man", collection: "Marvel" }),
      "Marvel Iron Man",
    );
  });

  test("expands a missing value to nothing rather than the token name", () => {
    assert.equal(expandTemplate("{studio}", { title: "x" }), "");
  });

  test("passes the sort languages through to sortableTitle", () => {
    assert.equal(expandTemplate("{sortableTitle}", { title: "La Bamba" }), "La Bamba");
    assert.equal(expandTemplate("{sortableTitle}", { title: "La Bamba" }, { sortLanguages: ["es"] }), "Bamba, La");
  });

  test("throws on an unknown token rather than writing the literal", () => {
    // Reaching here means something bypassed `templateError`; writing
    // "{titel}" into four hundred titles is worse than failing loudly.
    assert.throws(() => expandTemplate("{titel}", ctx), /Unknown metadata token/);
  });
});
