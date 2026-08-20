/**
 * The round trip is the test that matters: export a configured install, import
 * it into an empty one, and check the two agree. Everything else here is a
 * guard on a specific way that trip can go wrong quietly — a secret that
 * travelled, a tag key that didn't become a name, a conflict classified as
 * "identical" when it wasn't.
 */
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer, type TestContainer } from "@tinkerbell/composition/test-support";
import { ConfigStoreToken, REDACTED_SECRET } from "@tinkerbell/core";
import { ConfigHistoryToken } from "@tinkerbell/domain.config-history";
import { OverlaysToken } from "@tinkerbell/domain.overlays";
import { RulesToken } from "@tinkerbell/domain.rules";
import { SectionsToken } from "@tinkerbell/domain.sections";
import { plexSections, DbToken } from "@tinkerbell/db";
import type { Bundle } from "@tinkerbell/contracts";

import { createPortability, PortabilityToken } from "./index.ts";

/**
 * Tag values, per section, standing in for `client.getFilterFieldValues`.
 *
 * Different keys for the same name in each section, on purpose: that is the
 * whole reason a key cannot be exported.
 */
const TAGS: Record<string, Record<string, { key: string; title: string }[]>> = {
  "1": { genre: [{ key: "5840", title: "Horror" }] },
  "2": { genre: [{ key: "9001", title: "Horror" }] },
};

/**
 * A container whose portability domain has a stub Plex.
 *
 * `createTestContainer` builds the real graph, and the real graph asks Plex
 * for tag names. Replacing the whole domain rather than the client keeps the
 * substitution to one edge and leaves everything else — the rules domain the
 * importer writes through, the change log it records to — genuinely wired.
 */
function containerWithTags(): TestContainer {
  const c = createTestContainer({
    overrides: (r) => {
      r.replace(PortabilityToken, (ctx) => {
        const real = ctx.resolve(RulesToken);
        const overlays = ctx.resolve(OverlaysToken);
        return createPortability({
          db: ctx.resolve(DbToken),
          config: ctx.resolve(ConfigStoreToken),
          tagLookup: async (sectionId, field) => TAGS[sectionId]?.[field] ?? [],
          sections: () => ctx.resolve(SectionsToken).getLocalSections(),
          writers: {
            createRule: (input, origin) => real.createRule(input, origin),
            updateRule: (id, updates, origin) => real.updateRule(id, updates, origin),
            // No job runner in a test container; a bundle carrying schedules
            // records what it was asked to do rather than rescheduling a cron
            // that isn't running.
            updateJob: () => {},
            savePreset: (input) => overlays.savePreset(input),
            addOverlayConfig: (input) => overlays.addOverlayConfig(input),
            updateOverlayConfig: (id, patch) => overlays.updateOverlayConfig(id, patch),
            setConfig: (key, value) => ctx.resolve(ConfigStoreToken).setConfig(key, value),
          },
        });
      });
    },
  });
  // Two libraries, so section titles have something to resolve against.
  const db = c.resolve(DbToken);
  db.insert(plexSections).values({ key: "1", title: "Movies", type: "movie", syncedAt: 0 }).run();
  db.insert(plexSections).values({ key: "2", title: "TV Shows", type: "show", syncedAt: 0 }).run();
  return c;
}

const HORROR_RULE = {
  name: "Horror Gems",
  type: "smart_filter",
  config: {
    sections: ["Movies"],
    limit: 20,
    smartFilter: {
      kind: "group" as const,
      combinator: "all" as const,
      children: [{ kind: "leaf" as const, field: "genre", op: "=" as const, value: "5840" }],
    },
  },
};

describe("export", () => {
  const source = containerWithTags();
  after(() => source.dispose());

  const { setConfig } = source.resolve(ConfigStoreToken);
  const { exportBundle } = source.resolve(PortabilityToken);

  test("tag keys leave as display names, so the rule means the same thing elsewhere", async () => {
    source.resolve(RulesToken).createRule(HORROR_RULE);
    const { bundle } = await exportBundle({ parts: ["rules"], tinkerbellVersion: "test" });

    const rule = bundle.rules!.find((r) => r.name === "Horror Gems")!;
    const leaf = (rule.config.smartFilter as { children: { value: string }[] }).children[0];
    assert.equal(leaf.value, "Horror", "a numeric tag key in an export is a rule that matches nothing elsewhere");
  });

  test("secrets are absent by default, and the bundle says so", async () => {
    setConfig("global_radarr_api_key", "radarr-plaintext");
    setConfig("global_llm", { provider: "anthropic", model: "claude", apiKey: "nested-plaintext" } as never);

    const { bundle } = await exportBundle({ parts: ["config"], tinkerbellVersion: "test" });
    const serialised = JSON.stringify(bundle);

    assert.equal(bundle.containsSecrets, false);
    assert.ok(!serialised.includes("radarr-plaintext"), "a top-level secret must not travel");
    assert.ok(!serialised.includes("nested-plaintext"), "a nested secret must not travel either");
    // Deleted, not sentinel-stuffed: `REDACTED_SECRET` means "keep what you
    // have" to a form on *this* server and nothing at all in a file.
    assert.ok(!serialised.includes(REDACTED_SECRET));
    assert.equal((bundle.config!.global_llm as { model: string }).model, "claude", "the rest of the value survives");
  });

  test("with the flag, they travel and the bundle is marked", async () => {
    const { bundle } = await exportBundle({ parts: ["config"], includeSecrets: true, tinkerbellVersion: "test" });
    assert.equal(bundle.containsSecrets, true);
    assert.equal(bundle.config!.global_radarr_api_key, "radarr-plaintext");
  });

  test("auth state never travels, flag or not", async () => {
    setConfig("admin_allowed_user_ids", [12345]);
    const { bundle } = await exportBundle({ parts: ["config"], includeSecrets: true, tinkerbellVersion: "test" });
    assert.equal(
      bundle.config!.admin_allowed_user_ids,
      undefined,
      "importing an admin grant is a privilege escalation",
    );
  });
});

describe("the round trip", () => {
  test("export → import into an empty install reproduces the rule", async () => {
    const source = containerWithTags();
    const target = containerWithTags();
    try {
      source.resolve(RulesToken).createRule(HORROR_RULE);
      const { bundle } = await source.resolve(PortabilityToken).exportBundle({
        parts: ["rules"],
        tinkerbellVersion: "test",
      });

      const summary = await target.resolve(PortabilityToken).applyImport(bundle, {});
      assert.equal(summary.created, 1);
      assert.equal(summary.failed.length, 0);

      const imported = target
        .resolve(RulesToken)
        .getRules()
        .find((r) => r.name === "Horror Gems")!;
      assert.ok(imported, "the rule should exist on the target");
      const leaf = (imported.config.smartFilter as { children: { value: string }[] }).children[0];
      // Back to a key — the target's own key for "Horror" in its Movies
      // library, which happens to be the same here because both containers
      // share the fixture. The point is that it is a key again, not a name.
      assert.equal(leaf.value, "5840");
      assert.equal(imported.config.limit, 20);
    } finally {
      await source.dispose();
      await target.dispose();
    }
  });

  test("a tag this server has never heard of is reported, not silently dropped", async () => {
    const target = containerWithTags();
    try {
      const bundle = {
        formatVersion: 1,
        exportedAt: Date.now(),
        tinkerbellVersion: "test",
        containsSecrets: false,
        rules: [
          {
            id: "x",
            name: "Nonexistent genre",
            type: "smart_filter",
            enabled: true,
            position: 0,
            config: {
              sections: ["Movies"],
              smartFilter: {
                kind: "group",
                combinator: "all",
                children: [{ kind: "leaf", field: "genre", op: "=", value: "Claymation" }],
              },
            },
          },
        ],
      };
      const preview = await target.resolve(PortabilityToken).previewImport(bundle);
      assert.equal(preview.unresolvedTags.length, 1);
      assert.equal(preview.unresolvedTags[0].value, "Claymation");
      assert.equal(preview.unresolvedTags[0].ruleName, "Nonexistent genre");
    } finally {
      await target.dispose();
    }
  });
});

describe("conflicts", () => {
  test("new, identical and differs are told apart", async () => {
    const c = containerWithTags();
    try {
      const { createRule } = c.resolve(RulesToken);
      const portability = c.resolve(PortabilityToken);

      createRule({ name: "Untouched", type: "smart_filter", config: { limit: 5 } });
      createRule({ name: "Edited", type: "smart_filter", config: { limit: 5 } });

      const { bundle } = await portability.exportBundle({ parts: ["rules"], tinkerbellVersion: "test" });

      // One rule moves on this server after the export was taken — the exact
      // situation the preview exists to make visible.
      const edited = c
        .resolve(RulesToken)
        .getRules()
        .find((r) => r.name === "Edited")!;
      c.resolve(RulesToken).updateRule(edited.id, { config: { limit: 999 } });

      // And one rule in the bundle doesn't exist here at all.
      bundle.rules!.push({ ...bundle.rules![0], id: "new-id", name: "Brand New" });

      const preview = await portability.previewImport(bundle);
      const verdictOf = (label: string) => preview.items.find((i) => i.label === label)?.verdict;

      assert.equal(verdictOf("Untouched"), "identical");
      assert.equal(verdictOf("Edited"), "differs");
      assert.equal(verdictOf("Brand New"), "new");

      const editedItem = preview.items.find((i) => i.label === "Edited")!;
      assert.deepEqual(editedItem.changed, ["limit"]);
    } finally {
      await c.dispose();
    }
  });

  test("skip is the default, so an unanswered conflict leaves the local copy alone", async () => {
    const c = containerWithTags();
    try {
      const { createRule, updateRule, getRules } = c.resolve(RulesToken);
      const portability = c.resolve(PortabilityToken);

      const rule = createRule({ name: "Mine", type: "smart_filter", config: { limit: 5 } });
      const { bundle } = await portability.exportBundle({ parts: ["rules"], tinkerbellVersion: "test" });
      updateRule(rule.id, { config: { limit: 999 } });

      // No decisions passed at all.
      const summary = await portability.applyImport(bundle, {});
      assert.equal(summary.skipped, 1);
      assert.equal(getRules().find((r) => r.name === "Mine")!.config.limit, 999, "the local edit must survive");
    } finally {
      await c.dispose();
    }
  });

  test("overwrite replaces it, and the replacement is in the change history", async () => {
    const c = containerWithTags();
    try {
      const { createRule, updateRule, getRules } = c.resolve(RulesToken);
      const portability = c.resolve(PortabilityToken);
      const rule = createRule({ name: "Mine", type: "smart_filter", config: { limit: 5 } });
      const { bundle } = await portability.exportBundle({ parts: ["rules"], tinkerbellVersion: "test" });
      updateRule(rule.id, { config: { limit: 999 } });

      const summary = await portability.applyImport(bundle, { "rule:Mine": "overwrite" });
      assert.equal(summary.overwritten, 1);
      assert.equal(getRules().find((r) => r.name === "Mine")!.config.limit, 5);

      const history = c.resolve(ConfigHistoryToken).history({ entity: "rule", entityId: rule.id });
      assert.equal(history[0].action, "import");
      assert.equal(history[0].source, "import", "an import must not read as forty hand edits");
    } finally {
      await c.dispose();
    }
  });

  test("duplicate keeps both, under a name that says where it came from", async () => {
    const c = containerWithTags();
    try {
      const { createRule, updateRule, getRules } = c.resolve(RulesToken);
      const portability = c.resolve(PortabilityToken);
      const rule = createRule({ name: "Mine", type: "smart_filter", config: { limit: 5 } });
      const { bundle } = await portability.exportBundle({ parts: ["rules"], tinkerbellVersion: "test" });
      updateRule(rule.id, { config: { limit: 999 } });

      await portability.applyImport(bundle, { "rule:Mine": "duplicate" });
      const names = getRules().map((r) => r.name);
      assert.ok(names.includes("Mine"));
      assert.ok(names.includes("Mine (imported)"));
    } finally {
      await c.dispose();
    }
  });
});

describe("bundles this version can't read", () => {
  const c = containerWithTags();
  after(() => c.dispose());
  const { parseBundle } = c.resolve(PortabilityToken);

  test("a future format version is refused with a message that says what to do", () => {
    assert.throws(
      () =>
        parseBundle({
          formatVersion: 99,
          exportedAt: 0,
          tinkerbellVersion: "9.9.9",
          containsSecrets: false,
        } satisfies Partial<Bundle>),
      /format version 99.*update Tinkerbell/s,
    );
  });

  test("a malformed bundle fails before anything is written", () => {
    assert.throws(() => parseBundle({ rules: "not an array" }), /isn't a Tinkerbell bundle|damaged/);
    assert.throws(() => parseBundle("just a string"), /isn't a Tinkerbell bundle|damaged/);
  });

  test("a rule config the engine can't parse is blocked in the preview, not stored", async () => {
    const bad = {
      formatVersion: 1,
      exportedAt: Date.now(),
      tinkerbellVersion: "test",
      containsSecrets: false,
      rules: [
        {
          id: "x",
          name: "Hostile",
          type: "smart_filter",
          enabled: true,
          position: 0,
          // `sections` is a list of library titles; a string is the shape a
          // hand-edited bundle most plausibly gets wrong.
          config: { sections: "Movies" },
        },
      ],
    };

    const portability = c.resolve(PortabilityToken);
    const preview = await portability.previewImport(bad);
    const item = preview.items.find((i) => i.label === "Hostile")!;
    assert.ok(item.blocked, "an unparseable rule must be refused where somebody can see why");

    // And a caller who ignores the preview still writes nothing.
    const summary = await portability.applyImport(bad, { "rule:Hostile": "overwrite" });
    assert.equal(summary.created, 0);
    assert.equal(
      c
        .resolve(RulesToken)
        .getRules()
        .filter((r) => r.name === "Hostile").length,
      0,
    );
  });
});
