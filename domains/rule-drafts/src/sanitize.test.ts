/**
 * Everything a model is likely to get wrong, and what the draft does about it.
 * The rule is the same throughout: fix it when there's one obvious meaning,
 * drop it with a note when there isn't, never pass it through silently.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeDraft, type Vocabulary } from "./sanitize.ts";

const vocab: Vocabulary = {
  tags: new Map([
    ["genre", ["Action", "Comedy", "Horror"]],
    ["country", ["Denmark", "Norway", "Sweden"]],
    ["network", []],
  ]),
  users: [{ userId: 42, username: "sam", name: "Sam Gluck" }],
};

const leaves = (draft: Parameters<typeof sanitizeDraft>[0]) => sanitizeDraft(draft, vocab);

describe("sanitizeDraft", () => {
  it("keeps a valid draft as written, with no notes", () => {
    const { filter, notes } = leaves({
      combinator: "all",
      clauses: [
        { field: "genre", op: "=", value: "Action" },
        { field: "year", op: ">=", value: "1990" },
        { field: "tb.watchedByNobody", op: "=", value: "1" },
      ],
    });
    assert.deepEqual(notes, []);
    assert.deepEqual(filter, {
      kind: "group",
      combinator: "all",
      children: [
        { kind: "leaf", field: "genre", op: "=", value: "Action" },
        { kind: "leaf", field: "year", op: ">=", value: "1990" },
        { kind: "leaf", field: "tb.watchedByNobody", op: "=", value: "1" },
      ],
    });
  });

  it("matches tag values case-insensitively, in the library's own spelling", () => {
    const { filter } = leaves({ combinator: "all", clauses: [{ field: "genre", op: "=", value: "horror" }] });
    assert.equal((filter.children[0] as { value: string }).value, "Horror");
  });

  it("drops a tag value the library doesn't have, and an empty facet, saying so", () => {
    const { filter, notes } = leaves({
      combinator: "all",
      clauses: [
        { field: "genre", op: "=", value: "Nordic Noir" },
        { field: "network", op: "=", value: "HBO" },
        { field: "year", op: ">", value: "2000" },
      ],
    });
    assert.equal(filter.children.length, 1);
    assert.equal(notes.length, 2);
    assert.match(notes[0], /no genre called that/);
  });

  it("drops an invented field and an operator the field doesn't take", () => {
    const { filter, notes } = leaves({
      combinator: "all",
      clauses: [
        { field: "mood", op: "=", value: "cosy" },
        { field: "genre", op: ">=", value: "Action" },
      ],
    });
    assert.equal(filter.children.length, 0);
    assert.match(notes[0], /isn't a field/);
    assert.match(notes[1], /doesn't work on genre/);
  });

  it("normalises runtimes, booleans, ratings and bare years", () => {
    const { filter, notes } = leaves({
      combinator: "all",
      clauses: [
        { field: "duration", op: "<", value: "2h" },
        { field: "hdr", op: "=", value: "true" },
        { field: "audienceRating", op: ">=", value: "80" },
        { field: "originallyAvailableAt", op: "<", value: "2000" },
        { field: "duration", op: ">", value: "90" },
      ],
    });
    assert.deepEqual(
      filter.children.map((c) => (c as { value: string }).value),
      ["7200000", "1", "8", "2000-01-01", "5400000"],
    );
    // The two reinterpretations that change what a number means are said out loud.
    assert.equal(notes.length, 2);
  });

  it("refuses a value it can't read rather than guessing", () => {
    const { filter, notes } = leaves({
      combinator: "all",
      clauses: [
        { field: "addedAt", op: ">=", value: "last summer" },
        { field: "year", op: "=", value: "the nineties" },
      ],
    });
    assert.equal(filter.children.length, 0);
    assert.equal(notes.length, 2);
  });

  it("resolves 'watched by' to a user id, by username or display name", () => {
    const { filter, notes } = leaves({
      combinator: "all",
      clauses: [
        { field: "tb.watchedBy", op: "=", value: "Sam Gluck" },
        { field: "tb.watchedBy", op: "=", value: "nobody-here" },
      ],
    });
    assert.deepEqual(filter.children, [{ kind: "leaf", field: "tb.watchedBy", op: "=", value: "42" }]);
    assert.match(notes[0], /no user by that name/);
  });

  it("keeps an OR group of values, and lifts a group of one into its parent", () => {
    const { filter } = leaves({
      combinator: "all",
      clauses: [
        {
          combinator: "any",
          clauses: [
            { field: "country", op: "=", value: "Denmark" },
            { field: "country", op: "=", value: "Sweden" },
          ],
        },
        { combinator: "any", clauses: [{ field: "genre", op: "=", value: "Action" }] },
      ],
    });
    assert.equal(filter.children[0].kind, "group");
    assert.deepEqual(filter.children[1], { kind: "leaf", field: "genre", op: "=", value: "Action" });
  });

  it("takes watch-history conditions out of an OR, since they need AND", () => {
    const { filter, notes } = leaves({
      combinator: "any",
      clauses: [
        { field: "genre", op: "=", value: "Comedy" },
        { field: "tb.watchedByNobody", op: "=", value: "1" },
      ],
    });
    assert.deepEqual(filter.children, [{ kind: "leaf", field: "genre", op: "=", value: "Comedy" }]);
    assert.match(notes[0], /only be combined with AND/);
  });

  it("unwraps a root that holds a single group", () => {
    const { filter } = leaves({
      combinator: "all",
      clauses: [
        {
          combinator: "any",
          clauses: [
            { field: "genre", op: "=", value: "Action" },
            { field: "genre", op: "=", value: "Comedy" },
          ],
        },
      ],
    });
    assert.equal(filter.combinator, "any");
    assert.equal(filter.children.length, 2);
  });

  it("reports what the model said it couldn't express", () => {
    const { notes } = leaves({ combinator: "all", clauses: [], unsupported: ["with a twist ending"] });
    assert.deepEqual(notes, [`Couldn't express "with a twist ending" as a filter.`]);
  });
});
