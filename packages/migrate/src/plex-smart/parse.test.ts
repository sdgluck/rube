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
