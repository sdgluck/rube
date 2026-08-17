/**
 * The interesting cases are all about a colon that *isn't* a scope. Collection
 * and film titles are full of them — "Marvel: Phase One", "Alien: Romulus" —
 * and a palette that ate the first word of those queries would be worse than
 * one with no scopes at all.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery, SCOPES } from "./searchScopes.ts";

test("parseQuery", async (t) => {
  await t.test("splits a known short prefix off the query", () => {
    const { text, scope } = parseQuery("r: nolan");
    assert.equal(text, "nolan");
    assert.deepEqual(scope, { label: "Rules", kinds: ["rule"] });
  });

  await t.test("accepts the long spelling and is case-insensitive", () => {
    assert.equal(parseQuery("Rules:nightly").scope?.label, "Rules");
    assert.equal(parseQuery("JOB: sync").scope?.label, "Jobs");
  });

  await t.test("leaves a colon that doesn't name a scope alone", () => {
    const { text, scope } = parseQuery("Marvel: Phase One");
    assert.equal(text, "Marvel: Phase One");
    assert.equal(scope, null);
  });

  await t.test("treats a bare prefix as a scope with an empty query", () => {
    const { text, scope } = parseQuery("job:");
    assert.equal(text, "");
    assert.equal(scope?.label, "Jobs");
  });

  await t.test("ignores a colon that isn't leading", () => {
    assert.equal(parseQuery("phase one: rules").scope, null);
  });

  await t.test("no prefix is claimed by two scopes", () => {
    const seen = new Set<string>();
    for (const scope of SCOPES) {
      for (const prefix of scope.prefixes) {
        assert.ok(!seen.has(prefix), `"${prefix}:" is claimed twice`);
        seen.add(prefix);
      }
    }
  });
});
