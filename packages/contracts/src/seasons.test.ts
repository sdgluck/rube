import { test } from "node:test";
import assert from "node:assert/strict";
import { configIssues, configSchemaFor } from "./job-config.ts";
import { isMonthDayWindowActive } from "./rule-schedule.ts";
import { activeSeasons, resolveSeasons, SEASON_PRESETS } from "./seasons.ts";

const on = (iso: string) => new Date(`${iso}T12:00:00Z`);

test("a window wrapping the year end is active on both sides of it", () => {
  assert.equal(isMonthDayWindowActive("12-27", "01-01", on("2026-12-30"), "UTC"), true);
  assert.equal(isMonthDayWindowActive("12-27", "01-01", on("2027-01-01"), "UTC"), true);
  assert.equal(isMonthDayWindowActive("12-27", "01-01", on("2027-01-02"), "UTC"), false);
  assert.equal(isMonthDayWindowActive("12-27", "01-01", on("2026-12-26"), "UTC"), false);
});

test("a one-day window is that day, in the configured zone", () => {
  // 31 October 23:30 in New York is already 1 November in UTC.
  const lateHalloween = new Date("2026-11-01T03:30:00Z");
  assert.equal(isMonthDayWindowActive("10-31", "10-31", lateHalloween, "America/New_York"), true);
  assert.equal(isMonthDayWindowActive("10-31", "10-31", lateHalloween, "UTC"), false);
});

test("resolveSeasons is the presets untouched when nothing is configured", () => {
  const seasons = resolveSeasons({});
  assert.deepEqual(
    seasons.map((s) => s.key),
    SEASON_PRESETS.map((p) => p.key),
  );
  assert.ok(seasons.every((s) => !s.custom));
});

test("an override replaces only the fields it sets", () => {
  const [christmas] = resolveSeasons({ seasons: { christmas: { name: "Xmas", enabled: false } } });
  assert.equal(christmas.name, "Xmas");
  assert.equal(christmas.enabled, false);
  assert.equal(christmas.activeFrom, "12-01");
  assert.deepEqual(christmas.keywords, SEASON_PRESETS[0].keywords);
});

test("a window override with only one end keeps the preset's window", () => {
  const [christmas] = resolveSeasons({ seasons: { christmas: { activeFrom: "11-15" } } });
  assert.deepEqual([christmas.activeFrom, christmas.activeTo], ["12-01", "12-26"]);
});

test("an override for a preset that no longer exists is ignored, not an error", () => {
  const config = { seasons: { "retired-holiday": { enabled: true } } };
  assert.equal(resolveSeasons(config).length, SEASON_PRESETS.length);
  assert.deepEqual(configIssues("season-collections", config), []);
});

test("custom seasons come after the presets, on unless switched off", () => {
  const seasons = resolveSeasons({
    customSeasons: [
      {
        key: "custom-easter",
        name: "Easter",
        activeFrom: "03-29",
        activeTo: "04-06",
        keywords: [{ id: 9921, name: "easter" }],
      },
    ],
  });
  const easter = seasons.at(-1)!;
  assert.equal(easter.key, "custom-easter");
  assert.equal(easter.custom, true);
  assert.equal(easter.enabled, true);
});

test("activeSeasons leaves out switched-off seasons", () => {
  const halloween = on("2026-10-15");
  assert.deepEqual(
    activeSeasons(resolveSeasons({}), halloween, "UTC").map((s) => s.key),
    ["halloween"],
  );
  assert.deepEqual(activeSeasons(resolveSeasons({ seasons: { halloween: { enabled: false } } }), halloween, "UTC"), []);
});

test("Christmas and New Year don't overlap by default", () => {
  for (const day of ["2026-12-26", "2026-12-27"]) {
    assert.equal(activeSeasons(resolveSeasons({}), on(day), "UTC").length, 1, day);
  }
});

test("configIssues names what is wrong with a season list", () => {
  const issues = configIssues("season-collections", {
    seasons: { christmas: { activeFrom: "11-15" }, halloween: { keywords: [] } },
    customSeasons: [
      { key: "custom-x", name: "Christmas", activeFrom: "01-01", activeTo: "01-02", keywords: [{ id: 1, name: "x" }] },
      { key: "custom-x", name: "Other", activeFrom: "01-01", activeTo: "01-02", keywords: [{ id: 1, name: "x" }] },
    ],
    minItems: 40,
    maxItems: 10,
  });
  assert.ok(
    issues.some((i) => i.includes("Minimum items")),
    issues.join("\n"),
  );
  assert.ok(
    issues.some((i) => i.startsWith("Christmas: a date window needs both")),
    issues.join("\n"),
  );
  assert.ok(
    issues.some((i) => i.includes('share the key "custom-x"')),
    issues.join("\n"),
  );
  assert.ok(
    issues.some((i) => i.includes('More than one season is called "Christmas"')),
    issues.join("\n"),
  );
  assert.ok(
    issues.some((i) => i.startsWith("Halloween is on but has no keywords")),
    issues.join("\n"),
  );
});

test("the schema refuses a custom key that could collide with a preset", () => {
  const schema = configSchemaFor("season-collections");
  const parsed = schema.safeParse({
    customSeasons: [
      {
        key: "easter",
        name: "Easter",
        activeFrom: "03-29",
        activeTo: "04-06",
        keywords: [{ id: 9921, name: "easter" }],
      },
    ],
  });
  assert.equal(parsed.success, false);
});
