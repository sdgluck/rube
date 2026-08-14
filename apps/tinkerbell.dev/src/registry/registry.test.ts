/**
 * The gate between an authored pack and somebody's Plex server.
 *
 * Registry content is data, not code, so nothing else would catch a rule
 * whose config the generate job can't parse, or a smart filter carrying a
 * tag key from the machine it was authored on. Both fail silently at run
 * time — the rule produces an empty collection and says nothing about why.
 * So they fail here instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isGroupedRuleType,
  isTagField,
  producesManyCollections,
  ruleConfigSchema,
  RULE_TYPE_REQUIRES,
  RULE_TYPE_VALUES,
} from "@tinkerbell/contracts";
import { smartFilterGroupSchema, type SmartFilterNode } from "@tinkerbell/plex-smart-filter";
import { PACKS_BY_SLUG, REGISTRY, RULES_BY_SLUG, rulesForPack } from "./index.ts";

function leaves(node: SmartFilterNode): Extract<SmartFilterNode, { kind: "leaf" }>[] {
  return node.kind === "leaf" ? [node] : node.children.flatMap(leaves);
}

test("the index parses and is non-empty", () => {
  assert.equal(REGISTRY.formatVersion, 1);
  assert.ok(REGISTRY.packs.length >= 10, "expected at least ten curated packs");
  assert.ok(REGISTRY.rules.length > 0);
});

test("slugs are unique", () => {
  assert.equal(PACKS_BY_SLUG.size, REGISTRY.packs.length, "duplicate pack slug");
  assert.equal(RULES_BY_SLUG.size, REGISTRY.rules.length, "duplicate rule slug");
});

test("every pack references rules that exist, and every rule is used", () => {
  const referenced = new Set<string>();
  for (const pack of REGISTRY.packs) {
    assert.ok(pack.ruleSlugs.length > 0, `${pack.slug} has no rules`);
    for (const slug of pack.ruleSlugs) {
      assert.ok(RULES_BY_SLUG.has(slug), `pack "${pack.slug}" references unknown rule "${slug}"`);
      referenced.add(slug);
    }
  }
  const orphans = REGISTRY.rules.map((r) => r.slug).filter((s) => !referenced.has(s));
  assert.deepEqual(orphans, [], "rules not referenced by any pack");
});

test("every rule type is one the generate job can dispatch", () => {
  for (const rule of REGISTRY.rules) {
    assert.ok(
      (RULE_TYPE_VALUES as readonly string[]).includes(rule.type),
      `rule "${rule.slug}" has unknown type "${rule.type}"`,
    );
  }
});

test("every rule config parses against the real ruleConfigSchema", () => {
  for (const rule of REGISTRY.rules) {
    const parsed = ruleConfigSchema.safeParse(rule.config);
    assert.ok(parsed.success, `rule "${rule.slug}" has invalid config: ${parsed.error?.message}`);
  }
});

test("no rule ships instance-local config", () => {
  for (const rule of REGISTRY.rules) {
    // `sections` is written by the importer from the user's library picks;
    // `arr` carries a Radarr-local profile id and a host filesystem path.
    assert.ok(!("sections" in rule.config), `rule "${rule.slug}" must not ship sections`);
    assert.ok(!("arr" in rule.config), `rule "${rule.slug}" must not ship arr settings`);
  }
});

test("only rotating rules pin to the homepage", () => {
  // A pack may put its grouped rules on the home screen — that's the point of
  // "By Decade" — but only as a rotating subset, and only for rule types that
  // produce enough collections for rotation to mean anything. Everything else
  // ships unpinned: importing a pack shouldn't reorder somebody's home for the
  // sake of one smart filter. The import modal can override either way.
  for (const rule of REGISTRY.rules) {
    if (rule.config.pinToHomepage !== true) {
      assert.equal(rule.config.pinToHomepage, false, `rule "${rule.slug}" should ship pinToHomepage: false`);
      continue;
    }
    assert.ok(
      producesManyCollections(rule.type),
      `rule "${rule.slug}" pins to the homepage but doesn't build enough collections to rotate`,
    );
    assert.ok(
      typeof rule.config.pinRotationCount === "number" && rule.config.pinRotationCount > 0,
      `rule "${rule.slug}" pins to the homepage without a pinRotationCount`,
    );
  }
});

test("grouped rules ship uncapped", () => {
  // The pack author doesn't know how big the target library is. A `limit` or
  // `minItems` here would quietly drop the long tail on every server that
  // imports it — those are the importing user's call, via the import modal.
  for (const rule of REGISTRY.rules) {
    if (!isGroupedRuleType(rule.type)) continue;
    assert.ok(!("limit" in rule.config), `grouped rule "${rule.slug}" must not ship a limit`);
    assert.ok(!("minItems" in rule.config), `grouped rule "${rule.slug}" must not ship minItems`);
  }
});

test("smart filters are well-formed trees", () => {
  for (const rule of REGISTRY.rules) {
    if (rule.type !== "smart_filter") continue;
    const parsed = smartFilterGroupSchema.safeParse(rule.config.smartFilter);
    assert.ok(parsed.success, `rule "${rule.slug}" has an invalid smartFilter: ${parsed.error?.message}`);
    assert.ok(leaves(parsed.data!).length > 0, `rule "${rule.slug}" has an empty smartFilter`);
  }
});

test("tag values are display names, not this-server tag keys", () => {
  // The whole reason the registry has a resolver. A numeric value here means
  // somebody pasted a filter out of their own admin UI: it would import
  // cleanly, run without error, and match nothing.
  for (const rule of REGISTRY.rules) {
    if (rule.type !== "smart_filter") continue;
    const tree = smartFilterGroupSchema.parse(rule.config.smartFilter);
    for (const leaf of leaves(tree)) {
      if (!isTagField(leaf.field)) continue;
      assert.ok(
        !/^\d+$/.test(leaf.value.trim()),
        `rule "${rule.slug}" uses a numeric Plex tag key for ${leaf.field} ("${leaf.value}") — use the display name`,
      );
    }
  }
});

test("smart filters avoid advanced fields the handler can't emit", () => {
  // `filterTreeToPlexParams` emits `type=N` plus clauses and nothing else.
  // Plex ignores `show.`-prefixed fields without `includeAdvanced=1`, so such
  // a rule returns an empty result with no error attached.
  for (const rule of REGISTRY.rules) {
    if (rule.type !== "smart_filter") continue;
    const tree = smartFilterGroupSchema.parse(rule.config.smartFilter);
    for (const leaf of leaves(tree)) {
      assert.ok(
        !leaf.field.startsWith("show."),
        `rule "${rule.slug}" uses advanced field "${leaf.field}", which needs includeAdvanced=1`,
      );
    }
  }
});

test("declared requirements cover what the rule type needs", () => {
  for (const rule of REGISTRY.rules) {
    const needed = RULE_TYPE_REQUIRES[rule.type as keyof typeof RULE_TYPE_REQUIRES];
    if (!needed) continue;
    assert.ok(
      rule.requires.includes(needed),
      `rule "${rule.slug}" (${rule.type}) must declare requires: ["${needed}"]`,
    );
  }
});

test("show-only rules aren't bundled into movie-only packs and vice versa", () => {
  // A pack whose rules can't agree on a library kind can't be imported in one
  // go — the library picker would have nothing valid to offer.
  for (const pack of REGISTRY.packs) {
    const rules = rulesForPack(pack.slug);
    const usable = (["movie", "show"] as const).filter((kind) => rules.some((r) => r.mediaTypes.includes(kind)));
    assert.ok(usable.length > 0, `pack "${pack.slug}" has no importable rules for any library kind`);
  }
});
