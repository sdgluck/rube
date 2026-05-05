import assert from "node:assert/strict";
import { test } from "node:test";
import type { CollectionInput } from "../types.ts";
import { detectKometa } from "./detect.ts";
import { classifyOne, classifyCollections } from "./classify.ts";
import { buildPlan } from "./plan.ts";

function col(overrides: Partial<CollectionInput> & { title: string }): CollectionInput {
  return {
    ratingKey: overrides.ratingKey ?? `rk-${overrides.title.replace(/\s+/g, "-")}`,
    title: overrides.title,
    labels: overrides.labels ?? ["Kometa"],
    sectionId: overrides.sectionId ?? "1",
    sectionTitle: overrides.sectionTitle ?? "Films",
  };
}

test("detect: keeps Kometa-labelled, drops others", () => {
  const all = [
    col({ title: "A24", labels: ["Kometa"] }),
    col({ title: "Manual", labels: ["Tinkerbell"] }),
    col({ title: "Old PMM", labels: ["PMM"] }),
    col({ title: "No labels", labels: [] }),
  ];
  const detected = detectKometa(all);
  assert.deepEqual(
    detected.map((c) => c.title),
    ["A24", "Old PMM"],
  );
});

test("detect: label match is case-insensitive and trim-tolerant", () => {
  const detected = detectKometa([col({ title: "A24", labels: [" kometa "] })]);
  assert.equal(detected.length, 1);
});

test("classify: year, decade, resolution patterns win over name lists", () => {
  assert.equal(classifyOne(col({ title: "1995" })).bucket, "year");
  assert.equal(classifyOne(col({ title: "1990s" })).bucket, "decade");
  assert.equal(classifyOne(col({ title: "4K" })).bucket, "resolution");
  assert.equal(classifyOne(col({ title: "1080p" })).bucket, "resolution");
});

test("classify: streaming wins over network for shared names", () => {
  assert.equal(classifyOne(col({ title: "Netflix" })).bucket, "streaming");
  assert.equal(classifyOne(col({ title: "AMC" })).bucket, "network");
});

test("classify: studios, genres, countries, awards, universes, seasonal, based-on", () => {
  assert.equal(classifyOne(col({ title: "A24" })).bucket, "studio");
  assert.equal(classifyOne(col({ title: "Horror" })).bucket, "genre");
  assert.equal(classifyOne(col({ title: "Japan" })).bucket, "country");
  assert.equal(classifyOne(col({ title: "Oscar Winners" })).bucket, "award");
  // Kometa's universe/ folder is short-keyed; display names live under
  // franchise/ — so MCU classifies as franchise (Tinkerbell's tmdb_franchises
  // rule type covers it).
  assert.equal(classifyOne(col({ title: "Marvel Cinematic Universe" })).bucket, "franchise");
  assert.equal(classifyOne(col({ title: "Halloween" })).bucket, "seasonal");
  assert.equal(classifyOne(col({ title: "Based on a True Story" })).bucket, "based_on");
});

test("classify: full Kometa studio list — names previously hardcoded as a short list", () => {
  // Cases lifted directly from a real user's unmappable list that motivated
  // shipping the full Default-Images name set. If any of these regress to
  // unmappable, the data file is stale or the lookup is broken.
  for (const title of [
    "20th Century Fox Television",
    "21 Laps Entertainment",
    "3 Arts Entertainment",
    "87Eleven",
    "87North Productions",
    "Aamir Khan Productions",
    "Aardman",
  ]) {
    assert.equal(classifyOne(col({ title })).bucket, "studio", `expected ${title} to be a studio`);
  }
});

test("classify: strips common Kometa name suffixes ('Action Movies' → genre)", () => {
  assert.equal(classifyOne(col({ title: "Action Movies" })).bucket, "genre");
  assert.equal(classifyOne(col({ title: "Horror Films" })).bucket, "genre");
});

test("classify: actors via the heuristic name pattern", () => {
  for (const title of [
    "Adam Driver",
    "Al Pacino",
    "Anthony Hopkins",
    "Brad Pitt",
    "Cate Blanchett",
    "Chris Hemsworth",
  ]) {
    assert.equal(classifyOne(col({ title })).bucket, "actor", `expected ${title} to be an actor`);
  }
});

test("classify: explicit (Director) suffix wins over name pattern", () => {
  assert.equal(classifyOne(col({ title: "Brian De Palma (Director)" })).bucket, "director");
  assert.equal(classifyOne(col({ title: "Greta Gerwig (Director)" })).bucket, "director");
});

test("classify: Kometa separator collections classify as unmappable with reason", () => {
  const result = classifyOne(col({ title: "Actors Collections" }));
  assert.equal(result.bucket, null);
  assert.match(result.reason ?? "", /separator/i);
});

test("classify: person heuristic doesn't fire for studio-like names", () => {
  // "Marvel Studios" and "United Kingdom" both look like 2-cap-word names
  // but should be caught by their respective lookups before the heuristic.
  assert.equal(classifyOne(col({ title: "Marvel Studios" })).bucket, "studio");
  assert.equal(classifyOne(col({ title: "United Kingdom" })).bucket, "country");
});

test("classify: pure-language names (no country aliasing) fall to audio_language", () => {
  // "French" / "Spanish" appear in Kometa's country folder so they
  // intentionally classify as country — that's where Kometa puts those
  // collections. Languages with no country / studio counterpart land in
  // audio_language.
  assert.equal(classifyOne(col({ title: "Cantonese" })).bucket, "audio_language");
});

test("classify: actors with Latin-extended characters", () => {
  // Real-world cases that broke the original ASCII-only person regex.
  for (const title of ["Stellan Skarsgård", "François Truffaut", "Penélope Cruz", "Renée Zellweger"]) {
    assert.equal(classifyOne(col({ title })).bucket, "actor", `expected ${title} to be an actor`);
  }
});

test("classify: unrecognized names return null with reason", () => {
  const result = classifyOne(col({ title: "weird stuff" }));
  assert.equal(result.bucket, null);
  assert.match(result.reason ?? "", /no matching/);
});

test("plan: groups by (bucket, section), one PlanItem per group", () => {
  const classified = classifyCollections([
    col({ title: "A24", sectionId: "1", sectionTitle: "Films" }),
    col({ title: "Marvel Studios", sectionId: "1", sectionTitle: "Films" }),
    col({ title: "BBC", sectionId: "2", sectionTitle: "TV" }),
    col({ title: "Horror", sectionId: "1", sectionTitle: "Films" }),
    col({ title: "1995", sectionId: "1", sectionTitle: "Films" }),
    // lowercase + word "weird stuff" won't match the person-name heuristic,
    // any curated bucket, or any pattern — so it stays unmappable.
    col({ title: "weird stuff", sectionId: "1", sectionTitle: "Films" }),
  ]);
  const plan = buildPlan(classified, {
    supportedRuleTypes: { studio: "studios", network: "networks", genre: "genres" },
  });

  assert.equal(plan.totalSourceItems, 6);

  // studios — Films (A24 + Marvel Studios), genres — Films (Horror), networks — TV (BBC)
  assert.equal(plan.proposed.length, 3);
  const studios = plan.proposed.find((p) => p.bucket === "studio");
  assert.ok(studios);
  assert.equal(studios.replacesCount, 2);
  assert.equal(studios.ruleType, "studios");
  assert.equal(studios.ruleName, "Studios — Films");
  assert.deepEqual(studios.replacesRatingKeys.sort(), ["rk-A24", "rk-Marvel-Studios"].sort());

  // year is recognized but no rule type provided → future
  assert.equal(plan.future.length, 1);
  assert.equal(plan.future[0].bucket, "year");

  // "weird stuff" didn't classify → unmappable
  assert.equal(plan.unmappable.length, 1);
  assert.equal(plan.unmappable[0].title, "weird stuff");
});

test("plan: rule config carries section title for downstream filter", () => {
  const classified = classifyCollections([col({ title: "A24", sectionTitle: "Films" })]);
  const plan = buildPlan(classified, { supportedRuleTypes: { studio: "studios" } });
  assert.deepEqual(plan.proposed[0].ruleConfig, { sections: ["Films"], pinToHomepage: false });
});

test("plan: stable sort by section then bucket", () => {
  const classified = classifyCollections([
    col({ title: "Marvel Studios", sectionId: "2", sectionTitle: "TV" }),
    col({ title: "A24", sectionId: "1", sectionTitle: "Films" }),
    col({ title: "BBC", sectionId: "1", sectionTitle: "Films" }),
  ]);
  const plan = buildPlan(classified, {
    supportedRuleTypes: { studio: "studios", network: "networks" },
  });
  assert.deepEqual(
    plan.proposed.map((p) => `${p.sectionTitle}/${p.bucket}`),
    ["Films/network", "Films/studio", "TV/studio"],
  );
});
