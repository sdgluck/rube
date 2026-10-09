import { test } from "node:test";
import assert from "node:assert/strict";
import { transitionFor } from "./transitions.ts";

const base = { fromPath: "/rules", toPath: "/rules/42", hint: null, enabled: true } as const;

test("a push to a new screen slides in", () => {
  assert.equal(transitionFor({ ...base, action: "PUSH" }), "push");
});

test("our own back button pops; a gesture or browser back doesn't animate twice", () => {
  assert.equal(transitionFor({ ...base, action: "POP", hint: "back" }), "pop");
  assert.equal(transitionFor({ ...base, action: "POP" }), null);
});

test("filters, tab switches and replaces don't animate", () => {
  assert.equal(transitionFor({ ...base, action: "PUSH", toPath: "/rules" }), null);
  assert.equal(transitionFor({ ...base, action: "PUSH", hint: "tab" }), null);
  assert.equal(transitionFor({ ...base, action: "REPLACE" }), null);
});

test("nothing animates when transitions are off (desktop, reduced motion)", () => {
  assert.equal(transitionFor({ ...base, action: "PUSH", enabled: false }), null);
});
