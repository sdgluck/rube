/**
 * Against a real migrated database and the real container, because the two
 * things most worth asserting here are both wiring rather than logic: that a
 * write through `setConfig` reaches the log at all, and that a secret does not.
 * A fake recorder would prove neither.
 */
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { desc, eq } from "drizzle-orm";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { changeLog, DbToken } from "@tinkerbell/db";
import { ConfigStoreToken, REDACTED_SECRET, runAsActor } from "@tinkerbell/core";
import { OverlaysToken } from "@tinkerbell/domain.overlays";
import { RulesToken } from "@tinkerbell/domain.rules";

import { ConfigHistoryToken, diffSnapshots } from "./index.ts";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { setConfig, deleteConfig } = c.resolve(ConfigStoreToken);
const { history, snapshot } = c.resolve(ConfigHistoryToken);
const { createRule, updateRule, deleteRule, getRule } = c.resolve(RulesToken);
const { savePreset, deletePreset } = c.resolve(OverlaysToken);

/** Rows for one entity, newest first, straight out of the table. */
function rowsFor(entity: string, entityId: string) {
  return db
    .select()
    .from(changeLog)
    .where(eq(changeLog.entityId, entityId))
    .orderBy(desc(changeLog.id))
    .all()
    .filter((r) => r.entity === entity);
}

describe("what gets recorded", () => {
  test("a config write records one row, with the previous value", () => {
    setConfig("global_plex_url", "http://one:32400");
    setConfig("global_plex_url", "http://two:32400");

    const rows = rowsFor("config", "global_plex_url");
    assert.equal(rows.length, 2);
    assert.equal(rows[1].action, "create", "the first write of a key is a create");
    assert.equal(rows[1].before, null);
    assert.equal(rows[0].action, "update");
    assert.equal(rows[0].before, "http://one:32400");
    assert.equal(rows[0].after, "http://two:32400");
  });

  test("deleting a config key records the value it held", () => {
    setConfig("global_tmdb_region", "GB");
    deleteConfig("global_tmdb_region");

    const [newest] = rowsFor("config", "global_tmdb_region");
    assert.equal(newest.action, "delete");
    assert.equal(newest.before, "GB");
    assert.equal(newest.after, null);
  });

  test("a rule's whole lifecycle lands as three rows", () => {
    const rule = createRule({ name: "Test rule", type: "smart_filter", config: { limit: 10 } });
    updateRule(rule.id, { name: "Renamed", config: { limit: 25 } });
    deleteRule(rule.id);

    const rows = rowsFor("rule", rule.id);
    assert.deepEqual(
      rows.map((r) => r.action),
      ["delete", "update", "create"],
    );

    const update = rows[1];
    assert.equal((update.before as { name: string }).name, "Test rule");
    assert.equal((update.after as { name: string }).name, "Renamed");
    assert.deepEqual((update.after as { config: unknown }).config, { limit: 25 });

    // The delete keeps the last known state, so the history still says what was
    // lost after the recycle bin's tombstone has been pruned.
    assert.equal((rows[0].before as { name: string }).name, "Renamed");
    assert.equal(rows[0].after, null);
  });

  test("an overlay preset records create, update and delete", () => {
    const id = savePreset({ name: "Preset", data: { overlays: [] } as never });
    savePreset({ id, name: "Preset renamed", data: { overlays: [] } as never });
    deletePreset(id);

    assert.deepEqual(
      rowsFor("overlay_preset", id).map((r) => r.action),
      ["delete", "update", "create"],
    );
  });

  test("a write that moves nothing records nothing", () => {
    const rule = createRule({ name: "Idempotent", type: "smart_filter", config: { limit: 1 } });
    const before = rowsFor("rule", rule.id).length;
    // The registry's hash refresh does exactly this on rules nobody has touched.
    updateRule(rule.id, { name: "Idempotent", config: { limit: 1 } });
    assert.equal(rowsFor("rule", rule.id).length, before);
  });
});

describe("what does not get recorded", () => {
  test("secrets are redacted in both before and after", () => {
    setConfig("global_radarr_api_key", "first-key-plaintext");
    setConfig("global_radarr_api_key", "second-key-plaintext");

    const rows = rowsFor("config", "global_radarr_api_key");
    const serialised = JSON.stringify(rows);
    assert.ok(!serialised.includes("first-key-plaintext"), "the old key must not be in the log");
    assert.ok(!serialised.includes("second-key-plaintext"), "the new key must not be in the log");
    assert.equal(rows[0].before, REDACTED_SECRET);
    assert.equal(rows[0].after, REDACTED_SECRET);
  });

  test("a secret nested inside a structured value is redacted too", () => {
    setConfig("global_llm", { provider: "anthropic", model: "claude", apiKey: "nested-plaintext" } as never);
    const rows = rowsFor("config", "global_llm");
    assert.ok(!JSON.stringify(rows).includes("nested-plaintext"));
    assert.equal((rows[0].after as { apiKey: string }).apiKey, REDACTED_SECRET);
    // The rest of the object survives — redaction must not flatten the value.
    assert.equal((rows[0].after as { model: string }).model, "claude");
  });

  test("keys in UNLOGGED_CONFIG_KEYS produce no rows at all", () => {
    setConfig("registry_cache", { fetchedAt: 1, url: "https://tinkerbell.dev/registry/index.json", index: {} });
    setConfig("stats_panel_order", ["a", "b"]);
    setConfig("global_plex_owner_token_hash", "a-hash");

    assert.equal(rowsFor("config", "registry_cache").length, 0);
    assert.equal(rowsFor("config", "stats_panel_order").length, 0);
    assert.equal(rowsFor("config", "global_plex_owner_token_hash").length, 0);
  });
});

describe("attribution", () => {
  test("the ambient actor is what lands in source and username", () => {
    runAsActor({ source: "ui", username: "ada" }, () => {
      setConfig("global_asset_directory", "/assets");
    });
    const [row] = rowsFor("config", "global_asset_directory");
    assert.equal(row.source, "ui");
    assert.equal(row.username, "ada");
  });

  test("outside a request or a job, a write is attributed to the system", () => {
    setConfig("prerolls_plex_path", "/prerolls");
    const [row] = rowsFor("config", "prerolls_plex_path");
    assert.equal(row.source, "system");
    assert.equal(row.username, "");
  });

  test("concurrent actors do not bleed into each other", async () => {
    // The reason this is `AsyncLocalStorage` and not a module-level variable:
    // two overlapping requests must not attribute each other's writes.
    await Promise.all([
      runAsActor({ source: "ui", username: "alice" }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        setConfig("global_seerr_url", "http://alice");
      }),
      runAsActor({ source: "ui", username: "bob" }, async () => {
        setConfig("global_gotify_url", "http://bob");
      }),
    ]);

    assert.equal(rowsFor("config", "global_seerr_url")[0].username, "alice");
    assert.equal(rowsFor("config", "global_gotify_url")[0].username, "bob");
  });
});

describe("reading it back", () => {
  test("the newest entry for an entity is not offered as restorable", () => {
    const rule = createRule({ name: "Restorable", type: "smart_filter", config: { limit: 1 } });
    updateRule(rule.id, { config: { limit: 2 } });

    const entries = history({ entity: "rule", entityId: rule.id });
    assert.equal(entries[0].restorable, false, "the current state is not something to restore to");
    assert.equal(entries[1].restorable, true);
  });

  test("a delete is never restorable — that is the recycle bin's job", () => {
    const rule = createRule({ name: "Gone", type: "smart_filter", config: {} });
    deleteRule(rule.id);
    assert.equal(history({ entity: "rule", entityId: rule.id })[0].restorable, false);
  });

  test("restoring a version reproduces the earlier state exactly", () => {
    const rule = createRule({ name: "Original", type: "smart_filter", config: { limit: 5 } });
    updateRule(rule.id, { name: "Changed", config: { limit: 500 } });

    const entries = history({ entity: "rule", entityId: rule.id });
    const target = entries.find((e) => e.restorable)!;
    const restored = snapshot(target.id)!;
    const state = restored.after as { name: string; config: Record<string, unknown> };

    updateRule(rule.id, { name: state.name, config: state.config }, { source: "restore", action: "restore" });

    const now = getRule(rule.id)!;
    assert.equal(now.name, "Original");
    assert.deepEqual(now.config, { limit: 5 });

    // And the restore is itself a change, so the log stays a complete account
    // of how the row got to where it is — which is what makes restoring a
    // restore work without a special case.
    const after = history({ entity: "rule", entityId: rule.id });
    assert.equal(after[0].action, "restore");
    assert.equal(after[0].source, "restore");
  });
});

describe("the diff, computed at read time", () => {
  test("reports added, removed and changed fields by path", () => {
    const changes = diffSnapshots(
      { name: "A", config: { limit: 10, order: "title" } },
      { name: "B", config: { limit: 10, sections: ["Movies"] } },
    );
    assert.deepEqual(changes, [
      { path: "config.order", kind: "removed", before: "title" },
      { path: "config.sections", kind: "added", after: ["Movies"] },
      { path: "name", kind: "changed", before: "A", after: "B" },
    ]);
  });

  test("an array is one fact, not an element-by-element diff", () => {
    const changes = diffSnapshots({ sections: ["Movies", "TV"] }, { sections: ["TV", "Movies"] });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].path, "sections");
  });

  test("key order is not a change", () => {
    assert.deepEqual(diffSnapshots({ a: 1, b: 2 }, { b: 2, a: 1 }), []);
  });
});
