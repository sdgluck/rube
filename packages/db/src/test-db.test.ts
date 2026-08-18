/**
 * The helper the rest of the suite is about to be built on, so it is worth
 * asserting the two properties that make it an improvement on `setupTempDb`:
 * it needs no environment variable and no particular import order, and two of
 * them can exist at once.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createTestDb } from "./test-db.ts";
import { config } from "./schema.ts";
import { eq } from "drizzle-orm";

describe("createTestDb", () => {
  test("comes back migrated and writable, without touching DATA_DIR", () => {
    const before = process.env.DATA_DIR;
    const { db, dispose } = createTestDb("tinkerbell-db-support-test-");
    try {
      db.insert(config).values({ key: "global_plex_url", value: "http://plex:32400" }).run();
      const row = db.select().from(config).where(eq(config.key, "global_plex_url")).get();
      assert.equal(row?.value, "http://plex:32400");
      assert.equal(process.env.DATA_DIR, before);
    } finally {
      dispose();
    }
  });

  /**
   * Impossible under `setupTempDb`, which works by mutating one global — which
   * is why a test needing two databases (a migration, a before/after
   * comparison) had no way to ask for one.
   */
  test("two databases are independent", () => {
    const a = createTestDb("tinkerbell-db-a-");
    const b = createTestDb("tinkerbell-db-b-");
    try {
      a.db.insert(config).values({ key: "global_plex_url", value: "a" }).run();
      assert.equal(a.db.select().from(config).all().length, 1);
      assert.equal(b.db.select().from(config).all().length, 0);
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  test("dispose closes the connection and removes the directory", () => {
    const { db, dataDir, dispose } = createTestDb("tinkerbell-db-dispose-");
    dispose();
    assert.equal(existsSync(dataDir), false);
    assert.throws(() => db.select().from(config).all());
  });
});
