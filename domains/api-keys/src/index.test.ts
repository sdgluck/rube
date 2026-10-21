/**
 * A key is a credential, so most of this is about what must *not* work: a
 * revoked key, a near-miss, a value without the prefix, and the database
 * holding anything a stolen copy could present.
 */
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@rube/composition/test-support";
import { DbToken, apiKeys } from "@rube/db";

import { API_KEY_PREFIX, ApiKeysToken } from "./index.ts";

const T0 = Date.parse("2027-03-15T12:00:00Z");

function setup() {
  const c = createTestContainer({ now: T0 });
  after(() => c.dispose());
  return { c, keys: c.resolve(ApiKeysToken), db: c.resolve(DbToken) };
}

describe("api keys", () => {
  test("a minted key verifies as its owner and is listed without its secret", () => {
    const { keys } = setup();
    const created = keys.createApiKey("  Claude Desktop  ");

    assert.ok(created.key.startsWith(API_KEY_PREFIX));
    assert.equal(created.name, "Claude Desktop");
    assert.deepEqual(keys.verifyApiKey(created.key), { id: created.id, name: "Claude Desktop" });

    const [listed] = keys.listApiKeys();
    assert.equal(listed!.id, created.id);
    assert.ok(created.key.startsWith(listed!.prefix));
    assert.ok(listed!.prefix.length < 16, "the listed prefix must not be most of the key");
    assert.equal(JSON.stringify(keys.listApiKeys()).includes(created.key), false);
  });

  test("the database holds a digest, never the key", () => {
    const { keys, db } = setup();
    const { key } = keys.createApiKey("laptop");
    const rows = db.select().from(apiKeys).all();
    assert.equal(JSON.stringify(rows).includes(key), false);
  });

  test("anything else is refused", () => {
    const { keys } = setup();
    const { key } = keys.createApiKey("laptop");

    assert.equal(keys.verifyApiKey(undefined), undefined);
    assert.equal(keys.verifyApiKey(""), undefined);
    assert.equal(keys.verifyApiKey(key.slice(0, -1)), undefined);
    assert.equal(keys.verifyApiKey(key.slice(API_KEY_PREFIX.length)), undefined);
    assert.equal(keys.verifyApiKey(`${key}x`), undefined);
  });

  test("a revoked key stops working at once, and the others don't", () => {
    const { keys } = setup();
    const a = keys.createApiKey("a");
    const b = keys.createApiKey("b");

    assert.equal(keys.revokeApiKey(a.id), "a");
    assert.equal(keys.verifyApiKey(a.key), undefined);
    assert.deepEqual(keys.verifyApiKey(b.key), { id: b.id, name: "b" });
    assert.equal(keys.revokeApiKey(a.id), null);
  });

  test("last-used is recorded, but at most once a minute", () => {
    const { c, keys } = setup();
    const { key } = keys.createApiKey("laptop");
    assert.equal(keys.listApiKeys()[0]!.lastUsedAt, null);

    keys.verifyApiKey(key);
    assert.equal(keys.listApiKeys()[0]!.lastUsedAt, T0);

    c.advance(30_000);
    keys.verifyApiKey(key);
    assert.equal(keys.listApiKeys()[0]!.lastUsedAt, T0);

    c.advance(30_000);
    keys.verifyApiKey(key);
    assert.equal(keys.listApiKeys()[0]!.lastUsedAt, T0 + 60_000);
  });

  test("a key needs a usable name", () => {
    const { keys } = setup();
    assert.throws(() => keys.createApiKey("   "), /name/);
    assert.throws(() => keys.createApiKey("x".repeat(61)), /60/);
  });
});
