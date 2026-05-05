import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSmartFilterUri, type SmartFilterGroup, type SmartFilterNode } from "./parse.ts";

const root = (combinator: "all" | "any", ...children: SmartFilterNode[]): SmartFilterGroup => ({
  kind: "group",
  combinator,
  children,
});
const leaf = (field: string, op: "=" | "==" | "!=" | ">=" | "<=", value: string): SmartFilterNode => ({
  kind: "leaf",
  field,
  op,
  value,
});
const group = (combinator: "all" | "any", ...children: SmartFilterNode[]): SmartFilterNode => ({
  kind: "group",
  combinator,
  children,
});

test("strips noise fields and section path", () => {
  const { filter, unsupported } = parseSmartFilterUri("/library/sections/1/all?type=1&genre=Action&sort=titleSort:asc");
  assert.deepEqual(filter, root("all", leaf("genre", "=", "Action")));
  assert.deepEqual(unsupported, []);
});

test("decodes operator suffixes", () => {
  const { filter } = parseSmartFilterUri("/library/sections/1/all?type=1&year>>=2020&userRating<<=5&studio!=Disney");
  assert.deepEqual(
    filter,
    root("all", leaf("year", ">=", "2020"), leaf("userRating", "<=", "5"), leaf("studio", "!=", "Disney")),
  );
});

test("longest operator suffix wins (>>= not =)", () => {
  // Naïve `=` matching would split as field=`year>>` value=`2020`.
  const { filter, unsupported } = parseSmartFilterUri("/library/sections/1/all?year>>=2020");
  assert.deepEqual(filter, root("all", leaf("year", ">=", "2020")));
  assert.deepEqual(unsupported, []);
});

test("`==` exact-match op (Plex emits as %3D=)", () => {
  // Plex's UI distinguishes `field=value` (contains) from `field==value`
  // (exact match). The exact-match form encodes the extra `=` as `%3D=`.
  const { filter } = parseSmartFilterUri("/library/sections/1/all?show.studio%3D=HBO");
  assert.deepEqual(filter, root("all", leaf("show.studio", "==", "HBO")));
});

test("URL-decodes field and value", () => {
  const { filter } = parseSmartFilterUri("/library/sections/1/all?genre=Sci-Fi%20%26%20Fantasy");
  assert.deepEqual(filter, root("all", leaf("genre", "=", "Sci-Fi & Fantasy")));
});

test("strict gt/lt surface as unsupported", () => {
  const { filter, unsupported } = parseSmartFilterUri("/library/sections/1/all?year>>2020");
  assert.deepEqual(filter, root("all"));
  assert.equal(unsupported.length, 1);
  assert.match(unsupported[0], /strict gt/);
});

test("X-Plex-* params are ignored", () => {
  const { filter } = parseSmartFilterUri("/library/sections/1/all?genre=Action&X-Plex-Container-Size=50");
  assert.deepEqual(filter, root("all", leaf("genre", "=", "Action")));
});

test("URI without a query string returns an empty group", () => {
  const { filter, unsupported } = parseSmartFilterUri("/library/sections/1/all");
  assert.deepEqual(filter, root("all"));
  assert.deepEqual(unsupported, []);
});

test("and=1 separators are stripped silently", () => {
  // Plex's UI annotates AND'd clauses with explicit `and=1` between them.
  // AND is the default joiner, so the marker is a no-op.
  const { filter, unsupported } = parseSmartFilterUri(
    "/library/sections/1/all?genre=Action&and=1&year>>=2020&and=1&unwatched=1",
  );
  assert.deepEqual(unsupported, []);
  assert.deepEqual(
    filter,
    root("all", leaf("genre", "=", "Action"), leaf("year", ">=", "2020"), leaf("unwatched", "=", "1")),
  );
});

// ─── OR / group structure ─────────────────────────────────────────────

test("repeated `=` on same field folds into implicit `any` subgroup", () => {
  // Plex `genre=Action&genre=Comedy` is "genre IN (Action, Comedy)".
  const { filter, unsupported } = parseSmartFilterUri("/library/sections/1/all?genre=Action&genre=Comedy");
  assert.deepEqual(unsupported, []);
  assert.deepEqual(filter, root("any", leaf("genre", "=", "Action"), leaf("genre", "=", "Comedy")));
});

test("repeated `=` mixed with other AND clauses", () => {
  // genre IN (1204, 1859, 5) AND unwatched=1 — only the genre `=` triplet folds.
  const { filter, unsupported } = parseSmartFilterUri(
    "/library/sections/1/all?genre=5&genre=1204&genre=1859&unwatched=1",
  );
  assert.deepEqual(unsupported, []);
  assert.deepEqual(
    filter,
    root(
      "all",
      group("any", leaf("genre", "=", "5"), leaf("genre", "=", "1204"), leaf("genre", "=", "1859")),
      leaf("unwatched", "=", "1"),
    ),
  );
});

test("range queries (mixed ops on same field) survive folding", () => {
  // year>>=1990 AND year<<=1999 is a real AND range, not an IN.
  const { filter, unsupported } = parseSmartFilterUri("/library/sections/1/all?year>>=1990&year<<=1999");
  assert.deepEqual(unsupported, []);
  assert.deepEqual(filter, root("all", leaf("year", ">=", "1990"), leaf("year", "<=", "1999")));
});

test("explicit push/or/pop block becomes an `any` subgroup", () => {
  // `genre=Action&or=1&genre=Comedy` inside push/pop.
  const { filter, unsupported } = parseSmartFilterUri(
    "/library/sections/1/all?push=1&genre=Action&or=1&genre=Comedy&pop=1",
  );
  assert.deepEqual(unsupported, []);
  // Top-level is `any` because the only child is the unwrapped any-group;
  // simplifyGroup unwraps a single subgroup whose combinator differs.
  assert.deepEqual(filter, root("any", leaf("genre", "=", "Action"), leaf("genre", "=", "Comedy")));
});

test("explicit OR and implicit OR converge to the same shape", () => {
  // Same semantics as the previous test, expressed without push/or/pop.
  const explicit = parseSmartFilterUri("/library/sections/1/all?push=1&genre=Action&or=1&genre=Comedy&pop=1").filter;
  const implicit = parseSmartFilterUri("/library/sections/1/all?genre=Action&genre=Comedy").filter;
  assert.deepEqual(explicit, implicit);
});

test("OR group followed by AND clause", () => {
  // `(director IN ...) AND genre!=5840` — the Crème de la crème shape.
  const { filter, unsupported } = parseSmartFilterUri(
    "/library/sections/1/all?push=1&director=4670&or=1&director=20447&pop=1&genre!=5840",
  );
  assert.deepEqual(unsupported, []);
  assert.deepEqual(
    filter,
    root(
      "all",
      group("any", leaf("director", "=", "4670"), leaf("director", "=", "20447")),
      leaf("genre", "!=", "5840"),
    ),
  );
});

test("pipe-separated values expand into an `any` group", () => {
  const { filter, unsupported } = parseSmartFilterUri("/library/sections/1/all?genre=Action|Comedy");
  assert.deepEqual(unsupported, []);
  assert.deepEqual(filter, root("any", leaf("genre", "=", "Action"), leaf("genre", "=", "Comedy")));
});

// ─── Real-world fixtures from the user's library ──────────────────────

test("fixture: Lights, Camera, ACTION!", () => {
  const { filter, unsupported } = parseSmartFilterUri(
    "/library/sections/1/all?type=1&sort=random%3Adesc&limit=30&originallyAvailableAt%3E%3E=-20y&and=1&unwatched=1&and=1&genre!=1204&and=1&genre!=5&and=1&genre!=116&and=1&genre=7",
  );
  assert.deepEqual(unsupported, []);
  assert.deepEqual(
    filter,
    root(
      "all",
      leaf("originallyAvailableAt", ">=", "-20y"),
      leaf("unwatched", "=", "1"),
      leaf("genre", "!=", "1204"),
      leaf("genre", "!=", "5"),
      leaf("genre", "!=", "116"),
      leaf("genre", "=", "7"),
    ),
  );
});

test("fixture: Rom-coms (repeated genre= folds to any)", () => {
  const { filter, unsupported } = parseSmartFilterUri(
    "/library/sections/1/all?type=1&sort=rating%3Adesc&genre!=2135&and=1&genre!=7&and=1&genre=5&and=1&unwatched=1&and=1&genre=1204&and=1&genre=1859",
  );
  assert.deepEqual(unsupported, []);
  assert.deepEqual(
    filter,
    root(
      "all",
      leaf("genre", "!=", "2135"),
      leaf("genre", "!=", "7"),
      group("any", leaf("genre", "=", "5"), leaf("genre", "=", "1204"), leaf("genre", "=", "1859")),
      leaf("unwatched", "=", "1"),
    ),
  );
});

test("fixture: War.", () => {
  const { filter, unsupported } = parseSmartFilterUri(
    "/library/sections/1/all?type=1&sort=random%3Adesc&limit=30&unwatched=1&and=1&genre=271&and=1&originallyAvailableAt%3E%3E=-10y&and=1&genre=8",
  );
  assert.deepEqual(unsupported, []);
  assert.deepEqual(
    filter,
    root(
      "all",
      leaf("unwatched", "=", "1"),
      group("any", leaf("genre", "=", "271"), leaf("genre", "=", "8")),
      leaf("originallyAvailableAt", ">=", "-10y"),
    ),
  );
});

test("fixture: Crème de la crème (push/or/pop with directors)", () => {
  const { filter, unsupported } = parseSmartFilterUri(
    "/library/sections/1/all?type=1&sort=random%3Adesc&limit=30&unwatched=1&and=1&push=1&director=4670&or=1&director=20447&or=1&director=844&or=1&director=28733&or=1&director=7110&or=1&director=3642&pop=1&and=1&genre!=5840",
  );
  assert.deepEqual(unsupported, []);
  assert.deepEqual(
    filter,
    root(
      "all",
      leaf("unwatched", "=", "1"),
      group(
        "any",
        leaf("director", "=", "4670"),
        leaf("director", "=", "20447"),
        leaf("director", "=", "844"),
        leaf("director", "=", "28733"),
        leaf("director", "=", "7110"),
        leaf("director", "=", "3642"),
      ),
      leaf("genre", "!=", "5840"),
    ),
  );
});

test("fixture: Shows on HBO (network OR network OR studio==)", () => {
  const { filter, unsupported } = parseSmartFilterUri(
    "/library/sections/2/all?type=2&sort=originallyAvailableAt%3Adesc&push=1&show.network=106412&or=1&show.network=80939&or=1&show.studio%3D=HBO&pop=1",
  );
  assert.deepEqual(unsupported, []);
  // Single top-level child → simplifyGroup unwraps to make root the `any` itself.
  assert.deepEqual(
    filter,
    root(
      "any",
      leaf("show.network", "=", "106412"),
      leaf("show.network", "=", "80939"),
      leaf("show.studio", "==", "HBO"),
    ),
  );
});

test("fixture: Shows on Sky (OR group then AND clause)", () => {
  const { filter, unsupported } = parseSmartFilterUri(
    "/library/sections/2/all?type=2&sort=originallyAvailableAt%3Adesc&push=1&show.network=207005&or=1&show.network=127242&or=1&show.network=153710&or=1&show.network=97668&or=1&show.network=228524&or=1&show.network=94285&or=1&show.studio%3D=Sky%2520Atlantic&pop=1&and=1&show.unwatchedLeaves=1",
  );
  assert.deepEqual(unsupported, []);
  assert.deepEqual(
    filter,
    root(
      "all",
      group(
        "any",
        leaf("show.network", "=", "207005"),
        leaf("show.network", "=", "127242"),
        leaf("show.network", "=", "153710"),
        leaf("show.network", "=", "97668"),
        leaf("show.network", "=", "228524"),
        leaf("show.network", "=", "94285"),
        leaf("show.studio", "==", "Sky%20Atlantic"),
      ),
      leaf("show.unwatchedLeaves", "=", "1"),
    ),
  );
});
