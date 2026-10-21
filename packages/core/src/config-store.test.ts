/**
 * The config *store*, as opposed to `redactSecrets` — which is all
 * `config.test.ts` covered, and covers well.
 *
 * The gap that mattered: `getConfig` parsed against the schema and `setConfig`
 * did not. A value the schema rejects was written happily and then threw on
 * every read — and because `setConfig` reads the previous value to write the
 * change log, one bad write poisoned the key permanently. Every later attempt
 * to *correct* it threw before it could store anything, so the only way out was
 * editing the database by hand. A single mis-typed number in a settings payload
 * was enough to make that page unusable for good.
 *
 * `setConfig` now validates first, which turns that into an error at the call
 * site with the stored configuration still intact.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { createTestContainer } from "@rube/composition/test-support";
import { ConfigStoreToken } from "./index.ts";

const c = createTestContainer();
after(() => c.dispose());

const { getConfig, setConfig, deleteConfig } = c.resolve(ConfigStoreToken);

describe("round-tripping", () => {
  test("stores and reads a string", () => {
    setConfig("global_plex_url", "http://plex.local:32400");
    assert.equal(getConfig("global_plex_url"), "http://plex.local:32400");
  });

  test("stores and reads a number, a boolean and an object", () => {
    // Values go through a JSON column, so the type has to survive the trip.
    setConfig("backup_keep_count", 14);
    assert.equal(getConfig("backup_keep_count"), 14);

    setConfig("backup_enabled", false);
    assert.equal(getConfig("backup_enabled"), false);

    setConfig("global_llm", { provider: "anthropic", model: "claude", apiKey: "sk-x" } as never);
    assert.equal(getConfig("global_llm")?.model, "claude");
  });

  test("an unset key is undefined rather than a throw", () => {
    assert.equal(getConfig("global_omdb_api_key"), undefined);
  });

  test("a later write replaces the earlier value", () => {
    setConfig("global_plex_url", "http://one");
    setConfig("global_plex_url", "http://two");
    assert.equal(getConfig("global_plex_url"), "http://two");
  });

  test("deleteConfig returns the key to unset", () => {
    setConfig("global_plex_url", "http://one");
    deleteConfig("global_plex_url");
    assert.equal(getConfig("global_plex_url"), undefined);
  });
});

describe("validation on write", () => {
  test("a value below the schema's floor is refused", () => {
    assert.throws(() => setConfig("backup_keep_count", 0 as never), /Too small/);
  });

  test("a value above the schema's ceiling is refused", () => {
    assert.throws(() => setConfig("backup_keep_count", 10_000 as never), /Too big/);
  });

  test("the wrong type is refused", () => {
    assert.throws(() => setConfig("backup_enabled", "yes" as never), /expected boolean/);
    assert.throws(() => setConfig("global_plex_url", 42 as never), /expected string/);
  });

  test("a structured value missing a required field is refused", () => {
    assert.throws(() => setConfig("registry_cache", { fetchedAt: 1 } as never), /url/);
  });

  test("an unknown key is refused rather than silently stored", () => {
    assert.throws(() => setConfig("not_a_real_key" as never, "x" as never));
  });

  test("a refused write leaves the stored value untouched", () => {
    // The point of validating on the way in.
    setConfig("backup_keep_count", 9);
    assert.throws(() => setConfig("backup_keep_count", 0 as never));
    assert.equal(getConfig("backup_keep_count"), 9);
  });

  test("a refused write does not poison the key", () => {
    // The failure this exists for: before validation on write, the bad value
    // was stored, and `setConfig`'s own read-before-write then threw — so the
    // correcting write could never land either.
    setConfig("backup_keep_count", 9);
    assert.throws(() => setConfig("backup_keep_count", -1 as never));

    assert.doesNotThrow(() => setConfig("backup_keep_count", 3), "the key is still writable");
    assert.equal(getConfig("backup_keep_count"), 3);
  });

  test("a valid value at each boundary is accepted", () => {
    assert.doesNotThrow(() => setConfig("backup_keep_count", 1));
    assert.doesNotThrow(() => setConfig("backup_keep_count", 365));
  });
});
