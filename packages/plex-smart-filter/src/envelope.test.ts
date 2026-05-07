import assert from "node:assert/strict";
import { test } from "node:test";
import { splitSmartFilterContent, restoreSmartFilterContent } from "./envelope.ts";

const MACHINE = "abc123";
const BASE = "/library/sections/2/all";

function uri(query: string): string {
  return `server://${MACHINE}/com.plexapp.plugins.library${BASE}?${query}`;
}

test("splits machineId, basePath, type, and sort from a smart filter URI", () => {
  const { envelope, filter } = splitSmartFilterContent(uri("type=2&sort=titleSort:asc&genre=Action"));
  assert.equal(envelope.machineId, MACHINE);
  assert.equal(envelope.basePath, BASE);
  assert.equal(envelope.type, "2");
  assert.equal(envelope.sort, "titleSort:asc");
  assert.deepEqual(envelope.extras, []);
  assert.equal(filter.children.length, 1);
});

test("preserves includeAdvanced=1 across split + restore (regression for empty smart collections)", () => {
  // Plex silently ignores advanced filters like `show.genre` unless
  // includeAdvanced=1 is on the URI. Editing sort or any other field
  // must NOT drop this flag, or the smart query resolves to zero items.
  const original = uri("type=2&sort=titleSort:asc&show.genre=5&includeAdvanced=1");
  const { envelope, filter } = splitSmartFilterContent(original);
  assert.deepEqual(envelope.extras, [["includeAdvanced", "1"]]);

  // Round-trip should re-emit includeAdvanced=1.
  const restored = restoreSmartFilterContent(envelope, filter);
  assert.match(restored, /[?&]includeAdvanced=1(&|$)/);
});

test("preserves all known passthrough shape params", () => {
  const original = uri(
    "type=2&sort=titleSort:asc&genre=Action&limit=100&includeGuids=1&includeCollections=0&includeAdvanced=1",
  );
  const { envelope } = splitSmartFilterContent(original);
  const keys = envelope.extras.map(([k]) => k);
  assert.deepEqual(keys.sort(), ["includeAdvanced", "includeCollections", "includeGuids", "limit"]);
});

test("restore emits sort change without losing extras", () => {
  // Sort-only edit was the original repro.
  const original = uri("type=2&sort=titleSort:asc&show.genre=5&includeAdvanced=1");
  const { envelope, filter } = splitSmartFilterContent(original);
  envelope.sort = "addedAt:desc";

  const restored = restoreSmartFilterContent(envelope, filter);
  assert.match(restored, /[?&]sort=addedAt%3Adesc(&|$)/);
  assert.match(restored, /[?&]includeAdvanced=1(&|$)/);
  // The advanced filter expression must survive too.
  assert.match(restored, /show\.genre=5/);
});

test("ignores filter expressions when collecting extras (operator suffixes are not shape)", () => {
  // `year>>=2020` parses via URLSearchParams as key=`year>>` value=`2020`.
  // It must NOT end up in extras (it's a filter, handled by the tree).
  const original = uri("type=2&year>>=2020&sort=year:desc");
  const { envelope } = splitSmartFilterContent(original);
  assert.deepEqual(envelope.extras, []);
});

test("returns empty envelope for non-Plex URIs", () => {
  const { envelope, filter } = splitSmartFilterContent("not-a-plex-uri");
  assert.equal(envelope.machineId, "");
  assert.equal(envelope.basePath, "");
  assert.deepEqual(filter.children, []);
});
