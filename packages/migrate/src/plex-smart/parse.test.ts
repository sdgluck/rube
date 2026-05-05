import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSmartFilterUri } from "./parse.ts";

test("strips noise fields and section path", () => {
  const { filters, unsupported } = parseSmartFilterUri(
    "/library/sections/1/all?type=1&genre=Action&sort=titleSort:asc",
  );
  assert.deepEqual(filters, [{ field: "genre", op: "=", value: "Action" }]);
  assert.deepEqual(unsupported, []);
});

test("decodes operator suffixes", () => {
  const { filters } = parseSmartFilterUri("/library/sections/1/all?type=1&year>>=2020&userRating<<=5&studio!=Disney");
  assert.deepEqual(filters, [
    { field: "year", op: ">=", value: "2020" },
    { field: "userRating", op: "<=", value: "5" },
    { field: "studio", op: "!=", value: "Disney" },
  ]);
});

test("longest operator suffix wins (>>= not =)", () => {
  // Naïve `=` matching would split as field=`year>>` value=`2020` and
  // drop the operator entirely. The parser must try `>>=` first.
  const { filters, unsupported } = parseSmartFilterUri("/library/sections/1/all?year>>=2020");
  assert.deepEqual(filters, [{ field: "year", op: ">=", value: "2020" }]);
  assert.deepEqual(unsupported, []);
});

test("URL-decodes field and value", () => {
  const { filters } = parseSmartFilterUri("/library/sections/1/all?genre=Sci-Fi%20%26%20Fantasy");
  assert.deepEqual(filters, [{ field: "genre", op: "=", value: "Sci-Fi & Fantasy" }]);
});

test("OR-grouped values surface as unsupported (no silent drop)", () => {
  const { filters, unsupported } = parseSmartFilterUri("/library/sections/1/all?genre=Action|Comedy");
  assert.deepEqual(filters, []);
  assert.equal(unsupported.length, 1);
  assert.match(unsupported[0], /OR group/);
});

test("strict gt/lt surface as unsupported", () => {
  const { filters, unsupported } = parseSmartFilterUri("/library/sections/1/all?year>>2020");
  assert.deepEqual(filters, []);
  assert.equal(unsupported.length, 1);
  assert.match(unsupported[0], /strict gt/);
});

test("X-Plex-* params are ignored", () => {
  const { filters } = parseSmartFilterUri("/library/sections/1/all?genre=Action&X-Plex-Container-Size=50");
  assert.deepEqual(filters, [{ field: "genre", op: "=", value: "Action" }]);
});

test("empty value is unsupported (not silently empty)", () => {
  const { filters, unsupported } = parseSmartFilterUri("/library/sections/1/all?genre=");
  assert.deepEqual(filters, []);
  assert.deepEqual(unsupported, ["genre="]);
});

test("URI without a query string returns nothing", () => {
  const { filters, unsupported } = parseSmartFilterUri("/library/sections/1/all");
  assert.deepEqual(filters, []);
  assert.deepEqual(unsupported, []);
});

test("non-empty group markers (or/push/pop/and/group) are unsupported", () => {
  // Plex's group syntax: `genre=Action&or=1&genre=Comedy&pop=1` means
  // "(genre=Action) OR (genre=Comedy)". Stripping the markers and
  // emitting both genre clauses as AND would produce a contradiction.
  const { filters, unsupported } = parseSmartFilterUri("/library/sections/1/all?genre=Action&or=1&genre=Comedy&pop=1");
  // Both `or=1` and `pop=1` flagged as group markers; the two genre
  // clauses also flagged as a repeated field.
  assert.deepEqual(filters, []);
  assert(unsupported.some((u) => u.includes("or=1")));
  assert(unsupported.some((u) => u.includes("pop=1")));
});

test("repeated fields surface as unsupported (not silently AND'd)", () => {
  const { filters, unsupported } = parseSmartFilterUri("/library/sections/1/all?genre=Action&genre=Comedy");
  assert.deepEqual(filters, []);
  assert.equal(unsupported.length, 2);
  assert(unsupported.every((u) => u.includes("repeated field")));
});

test("repeated field demotion preserves single-occurrence clauses", () => {
  // `country=USA` appears once and should survive even though `genre`
  // is duplicated.
  const { filters, unsupported } = parseSmartFilterUri("/library/sections/1/all?genre=Action&genre=Comedy&country=USA");
  assert.deepEqual(filters, [{ field: "country", op: "=", value: "USA" }]);
  assert.equal(unsupported.length, 2);
});

test("range queries (same field, different ops) survive duplicate-field check", () => {
  // year>>=1990 AND year<<=1999 is a legit range, not a contradiction.
  const { filters, unsupported } = parseSmartFilterUri("/library/sections/1/all?year>>=1990&year<<=1999");
  assert.deepEqual(filters, [
    { field: "year", op: ">=", value: "1990" },
    { field: "year", op: "<=", value: "1999" },
  ]);
  assert.deepEqual(unsupported, []);
});

test("multiple clauses preserved in input order", () => {
  const { filters } = parseSmartFilterUri(
    "/library/sections/1/all?type=1&genre=Drama&year>>=1990&year<<=1999&country=USA",
  );
  assert.deepEqual(filters, [
    { field: "genre", op: "=", value: "Drama" },
    { field: "year", op: ">=", value: "1990" },
    { field: "year", op: "<=", value: "1999" },
    { field: "country", op: "=", value: "USA" },
  ]);
});
