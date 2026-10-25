/**
 * `extractJSON` is the parser every AI rule's answer goes through, and its
 * input is whatever a model wrote. The fallbacks used to be `/\{[\s\S]*\}/`
 * and `/\[[\s\S]*\]/`, which are quadratic on a long run of unclosed brackets;
 * these pin both that the spans it extracts are unchanged and that a hostile
 * answer can't stall a job.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJSON } from "./ai-collection-shared.ts";

describe("extractJSON", () => {
  it("parses a strict answer as-is", () => {
    assert.deepEqual(extractJSON('{"a":1}'), { a: 1 });
  });

  it("takes the first-to-last brace span out of surrounding prose", () => {
    assert.deepEqual(extractJSON('Sure! {"a":{"b":2}} Hope that helps.'), { a: { b: 2 } });
  });

  it("drops trailing commas when the raw span won't parse", () => {
    assert.deepEqual(extractJSON('Here: {"a":[1,2,],}'), { a: [1, 2] });
  });

  it("falls back to the first-to-last bracket span", () => {
    assert.deepEqual(extractJSON('Picks:\n["Alien", "Heat"]\nEnjoy'), ["Alien", "Heat"]);
  });

  it("returns null when nothing parses", () => {
    assert.equal(extractJSON("no json here"), null);
    assert.equal(extractJSON("} backwards {"), null);
  });

  it("stays linear on a long run of unclosed brackets", () => {
    const started = performance.now();
    assert.equal(extractJSON("{".repeat(100_000)), null);
    assert.equal(extractJSON("[".repeat(100_000)), null);
    assert.ok(performance.now() - started < 500);
  });
});
