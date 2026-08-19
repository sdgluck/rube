import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PLAYLIST_CAPABLE_RULE_TYPES, RULE_TYPE_VALUES } from "@tinkerbell/contracts";

import { buildYamlPlan } from "./plan.ts";
import { readImport } from "./read.ts";
import { mapFilters } from "./filters.ts";
import { mapSchedule } from "./schedule.ts";
import { expandDefinition } from "./templates.ts";
import { DEFAULT_MAPPINGS, resolveDefault } from "./defaults.ts";
import { parseYamlFile } from "./parse.ts";
import { parseTitleKey } from "./metadata.ts";
import type { ImportFile } from "./types.ts";
import type { MigrationPlan, PlanItem } from "../types.ts";

const FIXTURES = join(import.meta.dirname, "__fixtures__");

/** Read a fixture directory as the browser's directory picker would report it. */
function loadFixtureDir(name: string): ImportFile[] {
  const root = join(FIXTURES, name);
  const out: ImportFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push({ path: relative(root, full).replace(/\\/g, "/"), text: readFileSync(full, "utf8") });
    }
  };
  walk(root);
  return out;
}

function loadFixtureFile(name: string, path = "config.yml"): ImportFile[] {
  return [{ path, text: readFileSync(join(FIXTURES, name), "utf8") }];
}

const ALL_RULE_TYPES = new Set<string>(RULE_TYPE_VALUES);

/** Section map covering every library the fixtures use. */
const SECTIONS = new Map([
  ["Movies", { sectionId: "1", sectionTitle: "Movies" }],
  ["TV Shows", { sectionId: "2", sectionTitle: "TV Shows" }],
  ["Films", { sectionId: "1", sectionTitle: "Films" }],
]);

async function planFor(files: ImportFile[], existing?: Map<string, string>): Promise<MigrationPlan> {
  const imported = await readImport({ files });
  return buildYamlPlan(imported, {
    sections: SECTIONS,
    supportedRuleTypes: ALL_RULE_TYPES,
    playlistCapableRuleTypes: new Set(PLAYLIST_CAPABLE_RULE_TYPES),
    existingCollections: existing,
  });
}

function byName(plan: MigrationPlan, name: string): PlanItem {
  const item = plan.proposed.find((p) => p.ruleName === name);
  assert.ok(item, `expected a proposed rule named "${name}", got: ${plan.proposed.map((p) => p.ruleName).join(", ")}`);
  return item;
}

// ─── The guard that keeps the tables honest ────────────────────────────────

describe("mapping tables", () => {
  test("every default maps to a rule type this build actually has", () => {
    // The defaults table is written from Kometa's docs, not from Tinkerbell's
    // handler list, so it is exactly the kind of thing that rots when a rule
    // type is renamed. Catching it here beats catching it as a migration that
    // creates rules no handler can run.
    for (const [name, mapping] of Object.entries(DEFAULT_MAPPINGS)) {
      assert.ok(ALL_RULE_TYPES.has(mapping.ruleType), `default "${name}" → unknown rule type "${mapping.ruleType}"`);
    }
  });

  test("every proposed rule from every fixture is a real rule type", async () => {
    for (const files of [loadFixtureFile("defaults-only.yml"), loadFixtureDir("handwritten")]) {
      const plan = await planFor(files);
      for (const item of plan.proposed) {
        assert.ok(ALL_RULE_TYPES.has(item.ruleType), `${item.ruleName} → unknown rule type "${item.ruleType}"`);
      }
    }
  });

  test("every warning carries a code", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    for (const item of plan.proposed) {
      for (const w of item.warnings) {
        assert.ok(w.code.length > 0, `${item.ruleName} has a warning with no code`);
        assert.ok(w.message.length > 0, `${item.ruleName} has a warning with no message`);
      }
    }
  });
});

// ─── Parsing ───────────────────────────────────────────────────────────────

describe("parse", () => {
  test("reports a syntax error instead of throwing", () => {
    const parsed = parseYamlFile("bad.yml", "collections:\n  A:\n   x: [1, 2\n");
    assert.equal(parsed.value, null);
    assert.ok(parsed.diagnostics.some((d) => d.severity === "error"));
    assert.equal(parsed.diagnostics[0]?.file, "bad.yml");
  });

  test("resolves anchors and merge keys", () => {
    const parsed = parseYamlFile(
      "a.yml",
      ["base: &b", "  limit: 5", "collections:", "  X:", "    <<: *b", "    imdb_list: ls1"].join("\n"),
    );
    const collections = (parsed.value as { collections: Record<string, Record<string, unknown>> }).collections;
    assert.equal(collections.X!.limit, 5);
  });

  test("reports a line number for a definition", () => {
    const parsed = parseYamlFile(
      "a.yml",
      "collections:\n  First:\n    imdb_list: ls1\n  Second:\n    imdb_list: ls2\n",
    );
    assert.equal(parsed.lineOf(["collections", "Second"]), 5);
  });
});

// ─── Templates ─────────────────────────────────────────────────────────────

describe("templates", () => {
  const templates = {
    t: {
      default: { limit: 10 },
      optional: ["poster"],
      imdb_list: "<<url>>",
      url_poster: "<<poster>>",
      limit: "<<limit>>",
      summary: "Top <<limit>> from <<collection_name>>",
    },
  };

  test("substitutes variables and applies defaults", () => {
    const { definition } = expandDefinition({
      mappingName: "My List",
      definition: { template: { name: "t", url: "https://imdb.com/list/ls1/" } },
      templates,
      libraryVars: {},
      refVars: {},
      libraryName: "Films",
    });
    assert.equal(definition.imdb_list, "https://imdb.com/list/ls1/");
    assert.equal(definition.limit, 10);
    assert.equal(definition.summary, "Top 10 from My List");
  });

  test("drops attributes whose optional variable was never set", () => {
    // Without this the url_poster arrives as the literal "<<poster>>" and the
    // mapping proposes a rule pointing at a URL that doesn't exist.
    const { definition } = expandDefinition({
      mappingName: "My List",
      definition: { template: { name: "t", url: "u" } },
      templates,
      libraryVars: {},
      refVars: {},
      libraryName: "Films",
    });
    assert.ok(!("url_poster" in definition));
  });

  test("a whole-value variable keeps its type rather than being stringified", () => {
    const { definition } = expandDefinition({
      mappingName: "X",
      definition: { template: { name: "t2", genres: ["Action", "Comedy"] } },
      templates: { t2: { plex_search: { genre: "<<genres>>" } } },
      libraryVars: {},
      refVars: {},
      libraryName: "Films",
    });
    assert.deepEqual((definition.plex_search as { genre: unknown }).genre, ["Action", "Comedy"]);
  });

  test("definition attributes win over template attributes", () => {
    const { definition } = expandDefinition({
      mappingName: "X",
      definition: { template: { name: "t", url: "u" }, limit: 99 },
      templates,
      libraryVars: {},
      refVars: {},
      libraryName: "Films",
    });
    assert.equal(definition.limit, 99);
  });

  test("variable precedence runs library → ref → inline", () => {
    const t = { t3: { limit: "<<limit>>" } };
    const inline = expandDefinition({
      mappingName: "X",
      definition: { template: { name: "t3", limit: 3 } },
      templates: t,
      libraryVars: { limit: 1 },
      refVars: { limit: 2 },
      libraryName: "Films",
    });
    assert.equal(inline.definition.limit, 3);

    const ref = expandDefinition({
      mappingName: "X",
      definition: { template: { name: "t3" } },
      templates: t,
      libraryVars: { limit: 1 },
      refVars: { limit: 2 },
      libraryName: "Films",
    });
    assert.equal(ref.definition.limit, 2);
  });

  test("an unmodelled template feature warns rather than passing silently", () => {
    const { warnings } = expandDefinition({
      mappingName: "X",
      definition: { template: { name: "c" } },
      templates: { c: { conditionals: { x: {} }, imdb_list: "ls1" } },
      libraryVars: {},
      refVars: {},
      libraryName: "Films",
    });
    assert.ok(warnings.some((w) => w.includes("conditionals")));
  });

  test("a missing template is reported, not swallowed", () => {
    const { warnings } = expandDefinition({
      mappingName: "X",
      definition: { template: { name: "nope" } },
      templates: {},
      libraryVars: {},
      refVars: {},
      libraryName: "Films",
    });
    assert.ok(warnings.some((w) => w.includes("nope")));
  });
});

// ─── Filters ───────────────────────────────────────────────────────────────

describe("filters", () => {
  test("maps a plain equality", () => {
    const { filter } = mapFilters({ genre: "Horror" });
    assert.deepEqual(filter, {
      kind: "group",
      combinator: "all",
      children: [{ kind: "leaf", field: "genre", op: "=", value: "Horror" }],
    });
  });

  test("ORs multiple values for one field", () => {
    const { filter } = mapFilters({ genre: ["Action", "Comedy"] });
    const child = filter?.children[0];
    assert.equal(child?.kind, "group");
    assert.equal((child as { combinator: string }).combinator, "any");
  });

  test("ANDs negations rather than ORing them", () => {
    // `genre.not: [A, B]` means "neither". An OR of != would match everything,
    // since nothing is equal to both at once.
    const { filter } = mapFilters({ "genre.not": ["A", "B"] });
    assert.equal(filter?.children.length, 2);
    assert.ok(filter?.children.every((c) => c.kind === "leaf" && c.op === "!="));
  });

  test("maps comparison suffixes", () => {
    const { filter } = mapFilters({ "year.gte": 2000 });
    assert.deepEqual(filter?.children[0], { kind: "leaf", field: "year", op: ">=", value: "2000" });
  });

  test("drops a filter Plex can't evaluate, loudly", () => {
    const { filter, warnings } = mapFilters({ "tmdb_vote_count.gte": 100 });
    assert.equal(filter, null);
    assert.equal(warnings[0]?.code, "filter-not-in-plex");
  });

  test("drops an operator Plex has no equivalent for", () => {
    const { warnings } = mapFilters({ "title.regex": "^The" });
    assert.equal(warnings[0]?.code, "filter-op-unsupported");
  });
});

// ─── Schedules ─────────────────────────────────────────────────────────────

describe("schedules", () => {
  test("range becomes an active window, not a cron", () => {
    const { schedule } = mapSchedule("range(12/01-12/31)");
    assert.deepEqual(schedule, { activeFrom: "12-01", activeTo: "12-31" });
  });

  test("never means a rule that exists but is switched off", () => {
    const result = mapSchedule("never");
    assert.equal(result.disabled, true);
    assert.equal(result.schedule, undefined);
  });

  test("weekly picks the right cron day", () => {
    assert.equal(mapSchedule("weekly(sunday)").schedule?.cron, "0 3 * * 0");
    assert.equal(mapSchedule("weekly(wednesday)").schedule?.cron, "0 3 * * 3");
  });

  test("refuses a day-of-month that doesn't occur every month", () => {
    // Cron would silently skip February, producing a rule that misses a month
    // a year with no indication why.
    const { schedule, warnings } = mapSchedule("monthly(31)");
    assert.equal(schedule, undefined);
    assert.equal(warnings[0]?.code, "schedule-unrecognised");
  });

  test("an unreadable schedule warns instead of guessing", () => {
    const { warnings } = mapSchedule("whenever(i feel like it)");
    assert.equal(warnings[0]?.code, "schedule-unrecognised");
  });
});

// ─── Defaults ──────────────────────────────────────────────────────────────

describe("defaults", () => {
  test("honours include/exclude template variables", () => {
    const resolved = resolveDefault("genre", { exclude: ["Documentary", "Talk Show"], limit: 100 });
    assert.ok(resolved && "ruleType" in resolved);
    assert.equal(resolved.ruleType, "genres");
    assert.deepEqual(resolved.ruleConfig.excludeValues, ["Documentary", "Talk Show"]);
    assert.equal(resolved.ruleConfig.limit, 100);
  });

  test("separator files are skipped with a reason, not reported as unknown", () => {
    const resolved = resolveDefault("separator_chart", {});
    assert.ok(resolved && "skipped" in resolved);
  });

  test("an unmodelled template variable is named, not silently ignored", () => {
    const resolved = resolveDefault("genre", { name_format: "<<key_name>> Films" });
    assert.ok(resolved && "ruleType" in resolved);
    assert.ok(resolved.warnings.some((w) => w.code === "default-var-dropped"));
    assert.notEqual(resolved.confidence, "exact");
  });

  test("an unrecognised default returns null rather than a wrong rule", () => {
    assert.equal(resolveDefault("something_invented", {}), null);
  });
});

// ─── End to end: the defaults-only config ──────────────────────────────────

describe("a defaults-only config", () => {
  test("produces one rule per recognised default, per library", async () => {
    const plan = await planFor(loadFixtureFile("defaults-only.yml"));
    const types = plan.proposed.map((p) => p.ruleType).sort();
    assert.deepEqual(types, ["awards", "countries", "decades", "genres", "imdb_chart", "networks", "seasonal"]);
  });

  test("collapses several award defaults onto one awards rule", async () => {
    // Kometa ships one file per ceremony; creating five identical `awards`
    // rules would leave them fighting over the same collections.
    const plan = await planFor(loadFixtureFile("defaults-only.yml"));
    assert.equal(plan.proposed.filter((p) => p.ruleType === "awards").length, 1);
  });

  test("carries template variables into the rule config", async () => {
    const plan = await planFor(loadFixtureFile("defaults-only.yml"));
    const genres = plan.proposed.find((p) => p.ruleType === "genres")!;
    assert.deepEqual(genres.ruleConfig.excludeValues, ["Documentary", "Talk Show"]);
    assert.equal(genres.ruleConfig.limit, 100);
  });

  test("applies library-level template variables", async () => {
    const plan = await planFor(loadFixtureFile("defaults-only.yml"));
    const networks = plan.proposed.find((p) => p.ruleType === "networks")!;
    assert.equal(networks.ruleConfig.minItems, 5);
  });

  test("scopes each rule to the section its library maps to", async () => {
    const plan = await planFor(loadFixtureFile("defaults-only.yml"));
    const networks = plan.proposed.find((p) => p.ruleType === "networks")!;
    assert.equal(networks.sectionId, "2");
    assert.deepEqual(networks.ruleConfig.sections, ["TV Shows"]);
  });

  test("tells the user what still isn't coming across", async () => {
    // A user who loses something without being told is a user who discovers it
    // months later and doesn't trust the migration again.
    const plan = await planFor(loadFixtureFile("defaults-only.yml"));
    assert.ok(plan.diagnostics.some((d) => d.message.includes("playlist")));
  });

  test("migrates the overlay layout rather than warning about it", async () => {
    const imported = await readImport({ files: loadFixtureFile("defaults-only.yml") });
    const configs = imported.overlays.get("Movies") ?? [];
    assert.ok(
      configs.some((c) => c.overlayType === "resolution"),
      "the config asked for a resolution overlay",
    );
    assert.ok(
      configs.some((c) => c.overlayType === "imdb_rating"),
      "…and a ratings overlay",
    );
  });

  test("lists a default we don't support yet as a real gap", async () => {
    const plan = await planFor(loadFixtureFile("defaults-only.yml"));
    assert.ok(plan.unmappable.some((u) => u.title.includes("subgenre")));
  });

  test("but a concept Tinkerbell simply doesn't have isn't listed as a gap", async () => {
    // Separators exist to pad the Plex library view; Tinkerbell doesn't use
    // them, so nothing was lost. Listing them alongside genuine gaps would
    // pad the not-migrated report with things the user needn't act on.
    const plan = await planFor(loadFixtureFile("defaults-only.yml"));
    assert.ok(!plan.unmappable.some((u) => u.title.includes("separator")));
    assert.ok(!plan.unmappable.some((u) => u.title.includes("collectionless")));
    assert.ok(plan.diagnostics.some((d) => d.message.includes("separator")));
  });
});

// ─── End to end: the hand-written config ───────────────────────────────────

describe("a hand-written config", () => {
  test("maps an IMDb list template to an imdb_list rule", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    const item = byName(plan, "IMDb Top 250");
    assert.equal(item.ruleType, "imdb_list");
    assert.equal(item.ruleConfig.listId, "ls024149810");
    assert.equal(item.ruleConfig.minItems, 10);
  });

  test("carries an allowed poster URL but not a disallowed one", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    const item = byName(plan, "IMDb Top 250");
    const presentation = item.ruleConfig.presentation as Record<string, unknown>;
    assert.equal(presentation.poster, "url");
    assert.ok(String(presentation.posterUrl).startsWith("https://raw.githubusercontent.com/"));
  });

  test("turns plex_search into a smart filter and drops what Plex can't do", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    const item = byName(plan, "Modern Horror");
    assert.equal(item.ruleType, "smart_filter");
    const filter = item.ruleConfig.smartFilter as { children: unknown[] };
    assert.ok(filter.children.length >= 2);
    assert.ok(item.warnings.some((w) => w.code === "filter-not-in-plex"));
    assert.equal(item.confidence, "partial");
  });

  test("carries collection mode, order and sort title into presentation", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    const top = byName(plan, "IMDb Top 250").ruleConfig.presentation as Record<string, unknown>;
    assert.equal(top.collectionSort, "custom");
    assert.equal(top.sortTitle, "!01_IMDb Top 250");

    const christmas = byName(plan, "Christmas").ruleConfig.presentation as Record<string, unknown>;
    assert.equal(christmas.collectionMode, "hide");

    const fourK = byName(plan, "Four Ks").ruleConfig.presentation as Record<string, unknown>;
    assert.equal(fourK.collectionSort, "alpha");
  });

  test("a seasonal range becomes an active window", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    const item = byName(plan, "Christmas");
    assert.deepEqual(item.ruleConfig.schedule, { activeFrom: "12-01", activeTo: "12-31" });
  });

  test("a `never` definition still migrates — created, switched off", async () => {
    // This is the case title-scan can never see: it built no collection, so
    // scanning Plex finds nothing to migrate.
    const plan = await planFor(loadFixtureDir("handwritten"));
    const item = byName(plan, "Parked For Now");
    assert.equal(item.enabled, false);
    assert.ok(item.warnings.some((w) => w.code === "schedule-never"));
  });

  test("skips a definition the user had switched off with `test:`", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    assert.ok(!plan.proposed.some((p) => p.ruleName === "Work In Progress"));
    assert.ok(!plan.unmappable.some((u) => u.title === "Work In Progress"));
  });

  test("reads files reached through `folder:` as well as `file:`", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    byName(plan, "MDBList Picks");
    byName(plan, "Four Ks");
  });

  test("resolves merge keys inside a collection file", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    assert.equal(byName(plan, "MDBList Picks").ruleConfig.minItems, 3);
  });

  test("a public Trakt list maps, an account-scoped one doesn't", async () => {
    // The distinction is load-bearing: Tinkerbell authenticates to Trakt with
    // a client id, which reads public lists and nothing else. Migrating a
    // watchlist anyway would mint a rule that fails on every single run.
    const plan = await planFor(loadFixtureDir("handwritten"));
    const list = byName(plan, "From Trakt");
    assert.equal(list.ruleType, "list_source");
    assert.equal(list.ruleConfig.listProvider, "trakt");

    const watchlist = plan.unmappable.find((u) => u.title === "My Trakt Watchlist");
    assert.ok(watchlist);
    assert.match(watchlist.reason, /sign-in/);
  });

  test("an unsupported builder becomes unmappable with a reason, not a wrong rule", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    const entry = plan.unmappable.find((u) => u.title === "Letterboxd Favourites");
    assert.ok(entry);
    assert.match(entry.reason, /Letterboxd/);
    assert.deepEqual(entry.builders, ["letterboxd_list"]);
  });

  test("a definition with no builder is reported as such", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    const entry = plan.unmappable.find((u) => u.title === "Nothing To Build");
    assert.ok(entry);
    assert.match(entry.reason, /No builder/);
  });

  test("an unresolvable include is a diagnostic, and the rest still migrates", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    assert.ok(plan.diagnostics.some((d) => d.message.includes("remote.yml")));
    assert.ok(plan.diagnostics.some((d) => d.message.includes("missing.yml")));
    assert.ok(plan.proposed.length > 5, "the readable files should still have produced rules");
  });

  test("reports `operations:` as not migrated", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    assert.ok(plan.diagnostics.some((d) => d.message.includes("operations")));
  });

  test("every plan item points back at the file and definition it came from", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    const item = byName(plan, "IMDb Top 250");
    assert.equal(item.origin.kind, "yaml");
    assert.match(String(item.origin.file), /movies\.yml$/);
    assert.equal(item.origin.definition, "IMDb Top 250");
    assert.ok((item.origin.line ?? 0) > 0);
  });

  test("keys are stable across two reads of the same bundle", async () => {
    const files = loadFixtureDir("handwritten");
    const a = await planFor(files);
    const b = await planFor(files);
    assert.deepEqual(
      a.proposed.map((p) => p.key),
      b.proposed.map((p) => p.key),
    );
  });

  test("matches a definition to the live collection it built", async () => {
    const existing = new Map([["1::imdb top 250", "77001"]]);
    const plan = await planFor(loadFixtureDir("handwritten"), existing);
    const item = byName(plan, "IMDb Top 250");
    assert.deepEqual(item.replacesRatingKeys, ["77001"]);
    // A definition with no matching collection has nothing to delete, which is
    // normal rather than an error.
    assert.deepEqual(byName(plan, "Christmas").replacesRatingKeys, []);
  });
});

// ─── Overlays ──────────────────────────────────────────────────────────────

describe("overlays", () => {
  test("maps the Kometa defaults a user actually sees", async () => {
    const imported = await readImport({ files: loadFixtureDir("handwritten") });
    const configs = imported.overlays.get("Films") ?? [];
    const types = configs.map((c) => c.overlayType);
    assert.ok(types.includes("resolution"));
  });

  test("expands the ratings overlay into every source it was showing", async () => {
    // Kometa's ratings file draws up to three; migrating only the first would
    // silently halve what's on every poster.
    const imported = await readImport({ files: loadFixtureDir("handwritten") });
    const types = (imported.overlays.get("Films") ?? []).map((c) => c.overlayType);
    assert.ok(types.includes("imdb_rating"), "rating1: imdb");
    assert.ok(types.includes("rt_rating"), "rating2: rt");
  });

  test("says what it couldn't draw, and why", async () => {
    const imported = await readImport({ files: loadFixtureDir("handwritten") });
    const ribbon = imported.diagnostics.find((d) => d.message.includes("ribbon"));
    assert.ok(ribbon, "expected a diagnostic about the ribbon overlay");
    assert.match(ribbon.message, /images/);
  });

  test("reads a hand-written overlay file, honouring its alignment", async () => {
    const imported = await readImport({ files: loadFixtureDir("handwritten") });
    const configs = imported.overlays.get("Films") ?? [];
    assert.ok(
      configs.some((c) => c.overlayType === "resolution" && c.position === "bottom-right"),
      "the custom file put resolution bottom-right",
    );
  });

  test("never emits two badges in the same slot", async () => {
    // `overlay_configs` has a unique index on (section, position, order), so a
    // duplicate isn't untidy — it's a constraint violation at import time.
    const imported = await readImport({ files: loadFixtureDir("handwritten") });
    const configs = imported.overlays.get("Films") ?? [];
    const slots = configs.map((c) => `${c.position}::${c.order}`);
    assert.equal(new Set(slots).size, slots.length);
  });

  test("a config with no overlay files produces none", async () => {
    const imported = await readImport({ files: loadFixtureFile("defaults-only.yml") });
    // defaults-only.yml has overlay_files, so this asserts the opposite case
    // via a library that has none.
    assert.ok(!imported.overlays.has("TV Shows"));
  });
});

// ─── Per-item metadata ─────────────────────────────────────────────────────

describe("metadata files", () => {
  test("carries the hand-written edits across", async () => {
    const imported = await readImport({ files: loadFixtureDir("handwritten") });
    const overrides = imported.metadataOverrides.get("Films") ?? [];
    const starWars = overrides.find((o) => o.match.title === "Star Wars");
    assert.ok(starWars, "expected an override for Star Wars");
    assert.equal(starWars.match.year, 1977);
    assert.equal(starWars.fields.title, "Star Wars — A New Hope");
    assert.equal(starWars.fields.titleSort, "Star Wars 01");
    assert.deepEqual(starWars.tags.genre, ["Science Fiction", "Adventure"]);
  });

  test("keeps an explicit id, which is the only unambiguous way to match", async () => {
    const imported = await readImport({ files: loadFixtureDir("handwritten") });
    const thing = (imported.metadataOverrides.get("Films") ?? []).find((o) => o.match.title === "The Thing");
    assert.equal(thing?.match.imdb, "tt0084787");
    assert.equal(thing?.fields.contentRating, "R");
  });

  test("reports season and episode edits rather than dropping them silently", async () => {
    const imported = await readImport({ files: loadFixtureDir("handwritten") });
    assert.ok(imported.diagnostics.some((d) => /season or episode/.test(d.message)));
  });

  test("an entry with nothing settable produces no override", async () => {
    const imported = await readImport({ files: loadFixtureDir("handwritten") });
    const overrides = imported.metadataOverrides.get("Films") ?? [];
    assert.ok(!overrides.some((o) => o.match.title === "Ignored Entry"));
  });

  test("parses the title key Kometa writes", () => {
    assert.deepEqual(parseTitleKey("Star Wars (1977)"), { title: "Star Wars", year: 1977 });
    assert.deepEqual(parseTitleKey("Heat"), { title: "Heat" });
    // A parenthesised suffix that isn't a year stays part of the title.
    assert.deepEqual(parseTitleKey("Alien (Directors Cut)"), { title: "Alien (Directors Cut)" });
  });
});

// ─── Playlists ─────────────────────────────────────────────────────────────

describe("playlists", () => {
  test("a playlist definition becomes a rule with a playlist action", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    const item = byName(plan, "Marathon Night");
    assert.equal(item.ruleType, "imdb_list");
    const action = item.ruleConfig.action as Record<string, unknown>;
    assert.equal(action.kind, "playlist");
    assert.equal(action.playlistName, "Marathon Night");
    // Playlists aren't library-scoped, so a rule building one pools its
    // sections rather than producing one playlist per library.
    assert.equal(action.combineSections, true);
  });

  test("a selection with no single-playlist reading is reported, not mangled", async () => {
    // A grouped rule builds one collection per group; there is no honest way
    // to turn that into one ordered sequence.
    const plan = await planFor(loadFixtureDir("handwritten"));
    const entry = plan.unmappable.find((u) => u.title === "Studio Tour");
    assert.ok(entry);
    assert.match(entry.reason, /single playlist|one collection per group/);
  });

  test("playlists no longer warn that they aren't migrated", async () => {
    const plan = await planFor(loadFixtureDir("handwritten"));
    assert.ok(!plan.diagnostics.some((d) => /doesn't build playlists/.test(d.message)));
  });
});

// ─── Failure tolerance ─────────────────────────────────────────────────────

describe("failure tolerance", () => {
  test("one unparseable file doesn't sink the import", async () => {
    const plan = await planFor(loadFixtureDir("broken"));
    assert.ok(
      plan.diagnostics.some((d) => d.severity === "error" && d.file?.includes("broken.yml")),
      "expected an error naming the bad file",
    );
    byName(plan, "Fine");
  });

  test("no config.yml is an actionable message, not a crash", async () => {
    const plan = await planFor([{ path: "collections.yml", text: "collections:\n  A:\n    imdb_list: ls1\n" }]);
    assert.equal(plan.proposed.length, 0);
    assert.match(plan.diagnostics[0]!.message, /config\.yml/);
  });

  test("a library with no Plex section mapped is reported per definition", async () => {
    const imported = await readImport({ files: loadFixtureDir("handwritten") });
    const plan = buildYamlPlan(imported, { sections: new Map(), supportedRuleTypes: ALL_RULE_TYPES });
    assert.equal(plan.proposed.length, 0);
    assert.ok(plan.unmappable.every((u) => u.reason.includes("isn't mapped")));
  });

  test("a rule type this build lacks becomes unmappable, not a broken rule", async () => {
    const imported = await readImport({ files: loadFixtureDir("handwritten") });
    const plan = buildYamlPlan(imported, {
      sections: SECTIONS,
      supportedRuleTypes: new Set(["smart_filter"]),
    });
    assert.ok(plan.proposed.every((p) => p.ruleType === "smart_filter"));
    assert.ok(plan.unmappable.some((u) => u.reason.includes("can't run")));
  });
});
