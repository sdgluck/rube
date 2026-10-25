import { test } from "node:test";
import assert from "node:assert/strict";

import { trimTrailing } from "./trim.ts";

test("trims every trailing separator and nothing else", () => {
  assert.equal(trimTrailing("http://plex:32400///"), "http://plex:32400");
  assert.equal(trimTrailing("http://plex:32400/library"), "http://plex:32400/library");
  assert.equal(trimTrailing("///"), "");
  assert.equal(trimTrailing(""), "");
});

test("takes a set of separators for Windows paths", () => {
  assert.equal(trimTrailing("C:\\Prerolls\\/\\", "/\\"), "C:\\Prerolls");
});

test("stays linear on a long run of separators that isn't trailing", () => {
  const hostile = "/".repeat(200_000) + "x";
  const started = performance.now();
  assert.equal(trimTrailing(hostile), hostile);
  assert.ok(performance.now() - started < 100);
});
