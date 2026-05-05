import assert from "node:assert/strict";
import { test } from "node:test";
import { emitSmartFilterTree } from "./emit.ts";
import { parseSmartFilterUri } from "./parse.ts";

/**
 * Round-trip: parse a Plex URI, emit the resulting tree back to URL
 * fragments, parse those fragments — the second tree must equal the
 * first. Tests the contract that an imported smart-filter rule
 * produces the same tree when its emitted query string flows back
 * through Plex.
 */
function roundTrip(uri: string) {
  const a = parseSmartFilterUri(uri).filter;
  const fragments = emitSmartFilterTree(a);
  const b = parseSmartFilterUri(`/library/sections/1/all?${fragments.join("&")}`).filter;
  return { a, b, query: fragments.join("&") };
}

test("round-trip: simple AND chain", () => {
  const { a, b } = roundTrip("/library/sections/1/all?genre=Action&year>>=2020&unwatched=1");
  assert.deepEqual(a, b);
});

test("round-trip: implicit OR (repeated genre=) folds and survives", () => {
  const { a, b } = roundTrip("/library/sections/1/all?genre=Action&genre=Comedy&genre=Drama");
  assert.deepEqual(a, b);
});

test("round-trip: explicit push/or/pop OR group", () => {
  const { a, b } = roundTrip("/library/sections/1/all?push=1&director=4670&or=1&director=20447&pop=1&genre!=5840");
  assert.deepEqual(a, b);
});

test("round-trip: == exact-match op", () => {
  const { a, b } = roundTrip("/library/sections/1/all?show.studio%3D=HBO");
  assert.deepEqual(a, b);
});

// ─── Real-world fixtures (the 9 previously-unmappable collections) ───

test("round-trip: Lights, Camera, ACTION!", () => {
  const { a, b } = roundTrip(
    "/library/sections/1/all?type=1&sort=random%3Adesc&limit=30&originallyAvailableAt%3E%3E=-20y&and=1&unwatched=1&and=1&genre!=1204&and=1&genre!=5&and=1&genre!=116&and=1&genre=7",
  );
  assert.deepEqual(a, b);
});

test("round-trip: What the F*ck?!", () => {
  const { a, b } = roundTrip(
    "/library/sections/1/all?type=1&sort=mediaBitrate%3Adesc&genre=92&and=1&genre=5&and=1&originallyAvailableAt%3E%3E=-20y&and=1&genre=6&and=1&genre=613",
  );
  assert.deepEqual(a, b);
});

test("round-trip: Crème de la crème", () => {
  const { a, b } = roundTrip(
    "/library/sections/1/all?type=1&sort=random%3Adesc&limit=30&unwatched=1&and=1&push=1&director=4670&or=1&director=20447&or=1&director=844&or=1&director=28733&or=1&director=7110&or=1&director=3642&pop=1&and=1&genre!=5840",
  );
  assert.deepEqual(a, b);
});

test("round-trip: Rom-coms", () => {
  const { a, b } = roundTrip(
    "/library/sections/1/all?type=1&sort=rating%3Adesc&genre!=2135&and=1&genre!=7&and=1&genre=5&and=1&unwatched=1&and=1&genre=1204&and=1&genre=1859",
  );
  assert.deepEqual(a, b);
});

test("round-trip: War.", () => {
  const { a, b } = roundTrip(
    "/library/sections/1/all?type=1&sort=random%3Adesc&limit=30&unwatched=1&and=1&genre=271&and=1&originallyAvailableAt%3E%3E=-10y&and=1&genre=8",
  );
  assert.deepEqual(a, b);
});

test("round-trip: Shows on Amazon", () => {
  const { a, b } = roundTrip(
    "/library/sections/2/all?type=2&sort=addedAt%3Adesc&push=1&show.network=225975&or=1&show.studio%3D=Amazon%2520Studios&pop=1",
  );
  assert.deepEqual(a, b);
});

test("round-trip: Shows on Apple TV", () => {
  const { a, b } = roundTrip(
    "/library/sections/2/all?type=2&sort=addedAt%3Adesc&push=1&show.network=188402&or=1&show.network=81954&or=1&show.studio%3D=Apple%2520Studios&pop=1",
  );
  assert.deepEqual(a, b);
});

test("round-trip: Shows on HBO", () => {
  const { a, b } = roundTrip(
    "/library/sections/2/all?type=2&sort=originallyAvailableAt%3Adesc&push=1&show.network=106412&or=1&show.network=80939&or=1&show.studio%3D=HBO&pop=1",
  );
  assert.deepEqual(a, b);
});

test("round-trip: Shows on Sky", () => {
  const { a, b } = roundTrip(
    "/library/sections/2/all?type=2&sort=originallyAvailableAt%3Adesc&push=1&show.network=207005&or=1&show.network=127242&or=1&show.network=153710&or=1&show.network=97668&or=1&show.network=228524&or=1&show.network=94285&or=1&show.studio%3D=Sky%2520Atlantic&pop=1&and=1&show.unwatchedLeaves=1",
  );
  assert.deepEqual(a, b);
});

test("round-trip: Shows on The BBC", () => {
  const { a, b } = roundTrip(
    "/library/sections/2/all?type=2&sort=originallyAvailableAt%3Adesc&push=1&show.network=101913&or=1&show.network=81653&or=1&show.network=84898&or=1&show.network=92754&or=1&show.network=87654&or=1&show.network=90639&pop=1",
  );
  assert.deepEqual(a, b);
});
