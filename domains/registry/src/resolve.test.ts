import { test } from "node:test";
import assert from "node:assert/strict";
import type { RegistryRule } from "@rube/contracts";
import type { SmartFilterGroup, SmartFilterLeaf, SmartFilterNode } from "@rube/plex-smart-filter";
import { resolveRuleForImport, type TagLookup } from "./resolve.ts";

const MOVIES = { sectionId: "1", sectionTitle: "Movies" };
const TV = { sectionId: "2", sectionTitle: "TV Shows" };

/** Stands in for `client.getFilterFieldValues`. Values differ per section on
 *  purpose — that's the whole reason tag keys can't be published. */
const TAGS: Record<string, Record<string, { key: string; title: string }[]>> = {
  "1": {
    genre: [
      { key: "5840", title: "Horror" },
      { key: "1204", title: "Science Fiction" },
    ],
    director: [{ key: "4670", title: "David Lynch" }],
  },
  "2": {
    genre: [{ key: "9001", title: "Horror" }],
  },
};

const lookup: TagLookup = async (sectionId, field) => TAGS[sectionId]?.[field] ?? [];

function smartRule(filter: SmartFilterGroup, overrides: Partial<RegistryRule> = {}): RegistryRule {
  return {
    slug: "test-rule",
    name: "Test Rule",
    description: "…",
    type: "smart_filter",
    config: { collectionName: "Test", pinToHomepage: false, smartFilter: filter },
    requires: [],
    mediaTypes: ["movie", "show"],
    ...overrides,
  } as RegistryRule;
}

function leaves(node: SmartFilterNode): SmartFilterLeaf[] {
  return node.kind === "leaf" ? [node] : node.children.flatMap(leaves);
}

function filterOf(config: Record<string, unknown>): SmartFilterGroup {
  return config.smartFilter as SmartFilterGroup;
}

test("a display name is rewritten to this server's tag key", async () => {
  const rule = smartRule({
    kind: "group",
    combinator: "all",
    children: [{ kind: "leaf", field: "genre", op: "=", value: "Horror" }],
  });

  const { config, warnings } = await resolveRuleForImport(rule, [MOVIES], lookup);

  assert.deepEqual(warnings, []);
  assert.equal(leaves(filterOf(config))[0]!.value, "5840");
});

test("the same name resolves differently per server section", async () => {
  const rule = smartRule({
    kind: "group",
    combinator: "all",
    children: [{ kind: "leaf", field: "genre", op: "=", value: "Horror" }],
  });

  const movies = await resolveRuleForImport(rule, [MOVIES], lookup);
  const tv = await resolveRuleForImport(rule, [TV], lookup);

  assert.equal(leaves(filterOf(movies.config))[0]!.value, "5840");
  assert.equal(leaves(filterOf(tv.config))[0]!.value, "9001");
});

test("matching is case- and whitespace-insensitive", async () => {
  const rule = smartRule({
    kind: "group",
    combinator: "all",
    children: [{ kind: "leaf", field: "genre", op: "=", value: "  hOrRoR " }],
  });

  const { config, warnings } = await resolveRuleForImport(rule, [MOVIES], lookup);

  assert.deepEqual(warnings, []);
  assert.equal(leaves(filterOf(config))[0]!.value, "5840");
});

test("an unknown tag value warns instead of silently passing through", async () => {
  const rule = smartRule({
    kind: "group",
    combinator: "all",
    children: [{ kind: "leaf", field: "genre", op: "=", value: "Mumblecore" }],
  });

  const { config, warnings } = await resolveRuleForImport(rule, [MOVIES], lookup);

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]!.field, "genre");
  assert.equal(warnings[0]!.value, "Mumblecore");
  assert.equal(warnings[0]!.sectionTitle, "Movies");
  // The clause survives verbatim — the rule still imports and the user is
  // told which part of it won't match.
  assert.equal(leaves(filterOf(config))[0]!.value, "Mumblecore");
});

test("non-tag leaves are left completely alone", async () => {
  const rule = smartRule({
    kind: "group",
    combinator: "all",
    children: [
      { kind: "leaf", field: "unwatched", op: "=", value: "1" },
      { kind: "leaf", field: "rating", op: ">=", value: "7.5" },
      { kind: "leaf", field: "originallyAvailableAt", op: ">=", value: "-10y" },
      { kind: "leaf", field: "addedAt", op: ">=", value: "-30d" },
    ],
  });

  const { config, warnings } = await resolveRuleForImport(rule, [MOVIES], lookup);

  assert.deepEqual(warnings, []);
  assert.deepEqual(
    leaves(filterOf(config)).map((l) => l.value),
    ["1", "7.5", "-10y", "-30d"],
  );
});

test("nested any-groups are resolved recursively", async () => {
  const rule = smartRule({
    kind: "group",
    combinator: "all",
    children: [
      { kind: "leaf", field: "unwatched", op: "=", value: "1" },
      {
        kind: "group",
        combinator: "any",
        children: [
          { kind: "leaf", field: "genre", op: "=", value: "Horror" },
          { kind: "leaf", field: "genre", op: "=", value: "Science Fiction" },
        ],
      },
    ],
  });

  const { config, warnings } = await resolveRuleForImport(rule, [MOVIES], lookup);

  assert.deepEqual(warnings, []);
  assert.deepEqual(
    leaves(filterOf(config)).map((l) => l.value),
    ["1", "5840", "1204"],
  );
});

test("a value that is already a tag key is left as-is", async () => {
  // Re-resolving an imported config (as an update does) must be idempotent.
  const rule = smartRule({
    kind: "group",
    combinator: "all",
    children: [{ kind: "leaf", field: "genre", op: "=", value: "5840" }],
  });

  const { config, warnings } = await resolveRuleForImport(rule, [MOVIES], lookup);

  assert.deepEqual(warnings, []);
  assert.equal(leaves(filterOf(config))[0]!.value, "5840");
});

test("section titles are written from the chosen libraries", async () => {
  const rule = smartRule({
    kind: "group",
    combinator: "all",
    children: [{ kind: "leaf", field: "unwatched", op: "=", value: "1" }],
  });

  const { config } = await resolveRuleForImport(rule, [MOVIES, TV], lookup);

  assert.deepEqual(config.sections, ["Movies", "TV Shows"]);
});

test("a clause unresolvable in a secondary library is still reported", async () => {
  // "Science Fiction" exists in Movies but not in TV Shows. Importing into
  // both should say so, rather than reporting clean because the first
  // library happened to work.
  const rule = smartRule({
    kind: "group",
    combinator: "all",
    children: [{ kind: "leaf", field: "genre", op: "=", value: "Science Fiction" }],
  });

  const { config, warnings } = await resolveRuleForImport(rule, [MOVIES, TV], lookup);

  assert.equal(leaves(filterOf(config))[0]!.value, "1204", "resolved against the first library");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]!.sectionTitle, "TV Shows");
});

test("a failing tag lookup degrades to warnings, not a thrown import", async () => {
  const failing: TagLookup = async () => {
    throw new Error("Plex is down");
  };
  const rule = smartRule({
    kind: "group",
    combinator: "all",
    children: [{ kind: "leaf", field: "genre", op: "=", value: "Horror" }],
  });

  const { warnings } = await resolveRuleForImport(rule, [MOVIES], failing);

  assert.equal(warnings.length, 1);
});

test("arr settings are stripped even if a pack ships them", async () => {
  const rule = smartRule(
    { kind: "group", combinator: "all", children: [{ kind: "leaf", field: "unwatched", op: "=", value: "1" }] },
    {
      config: {
        collectionName: "Test",
        smartFilter: { kind: "group", combinator: "all", children: [] },
        arr: { enabled: true, qualityProfileId: 7, rootFolderPath: "/mnt/media" },
      },
    },
  );

  const { config } = await resolveRuleForImport(rule, [MOVIES], lookup);

  assert.ok(!("arr" in config), "arr must never survive an import");
});

test("non-smart-filter rules pass through with sections injected", async () => {
  const rule: RegistryRule = {
    slug: "by-decade",
    name: "By Decade",
    description: "…",
    type: "decades",
    config: { pinToHomepage: false },
    requires: [],
    mediaTypes: ["movie", "show"],
  };

  const { config, warnings } = await resolveRuleForImport(rule, [MOVIES], lookup);

  assert.deepEqual(warnings, []);
  assert.deepEqual(config, { pinToHomepage: false, sections: ["Movies"] });
});

test("resolution does not mutate the published rule", async () => {
  const filter: SmartFilterGroup = {
    kind: "group",
    combinator: "all",
    children: [{ kind: "leaf", field: "genre", op: "=", value: "Horror" }],
  };
  const rule = smartRule(filter);

  await resolveRuleForImport(rule, [MOVIES], lookup);

  // The cached registry index is shared across imports — rewriting it in
  // place would leak one server's tag keys into the next import.
  assert.equal(leaves(filter)[0]!.value, "Horror");
  assert.equal(leaves(rule.config.smartFilter as SmartFilterGroup)[0]!.value, "Horror");
});
