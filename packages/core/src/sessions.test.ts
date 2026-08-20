/**
 * Session behaviour that the admin gate depends on: scopes don't leak into
 * each other, expiry is enforced on read, sliding refresh keeps a live admin
 * session alive, and the raw cookie token never reaches the database.
 *
 * These need a real schema, which `createTestDb` applies to a throwaway file
 * in-process. It used to take a hand-written `mkdtempSync` + `DATA_DIR` +
 * `execFileSync(migrate.ts)` preamble and a `before` hook full of dynamic
 * imports, purely because the connection opened the moment anything imported
 * `@tinkerbell/db`.
 */
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { plexSessions } from "@tinkerbell/db";
import { createTestDb } from "@tinkerbell/db/test-db";
import { createConfigStore } from "./config.ts";
import { createSessions, sessionMaxAgeSeconds } from "./sessions.ts";

const testDb = createTestDb("tinkerbell-sessions-test-");
after(testDb.dispose);

const db = testDb.db;
const sessions = createSessions({ db, config: createConfigStore({ db, recordChange: () => {} }) });

describe("session scopes", () => {
  test("an admin session is invisible to a portal read, and the reverse", () => {
    const adminToken = sessions.createPlexSession(1, "owner", "admin");
    const portalToken = sessions.createPlexSession(2, "viewer", "portal");

    assert.equal(sessions.getPlexSession(adminToken, "admin")?.username, "owner");
    assert.equal(sessions.getPlexSession(adminToken, "portal"), undefined);

    assert.equal(sessions.getPlexSession(portalToken, "portal")?.username, "viewer");
    assert.equal(sessions.getPlexSession(portalToken, "admin"), undefined);
  });

  test("only the SHA-256 of the token is stored", () => {
    const raw = sessions.createPlexSession(3, "hashed", "admin");
    const rows = db.select().from(plexSessions).all();
    const stored = rows.find((r) => r.userId === 3);

    assert.ok(stored);
    assert.equal(stored.id, createHash("sha256").update(raw).digest("hex"));
    // The raw token must appear nowhere in the row, under any column.
    assert.ok(!JSON.stringify(rows).includes(raw));
  });

  test("an expired session is rejected and pruned", () => {
    const raw = sessions.createPlexSession(4, "stale", "admin");
    const id = createHash("sha256").update(raw).digest("hex");
    db.update(plexSessions)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(plexSessions.id, id))
      .run();

    assert.equal(sessions.getPlexSession(raw, "admin"), undefined);
    const still = db.select().from(plexSessions).where(eq(plexSessions.id, id)).get();
    assert.equal(still, undefined, "an expired session should be deleted on the read that rejected it");
  });

  test("sliding refresh extends a live session, and a fresh one is left alone", () => {
    const raw = sessions.createPlexSession(5, "active", "admin");
    const id = createHash("sha256").update(raw).digest("hex");

    // Just-created: nothing to slide, and no write.
    assert.equal(sessions.getPlexSession(raw, "admin")?.refreshed, false);

    // Two days in, the expiry has drifted far enough to be worth moving.
    const twoDaysOn = Date.now() + 5 * 24 * 60 * 60 * 1000;
    db.update(plexSessions).set({ expiresAt: twoDaysOn }).where(eq(plexSessions.id, id)).run();

    assert.equal(sessions.getPlexSession(raw, "admin")?.refreshed, true);
    const after = db.select().from(plexSessions).where(eq(plexSessions.id, id)).get();
    assert.ok(after && after.expiresAt > twoDaysOn, "expiry should have moved forward");
  });

  test("admin sessions are shorter-lived than portal ones", () => {
    assert.ok(sessionMaxAgeSeconds("admin") < sessionMaxAgeSeconds("portal"));
  });

  test("deleting a scope leaves the other scope's sessions alone", () => {
    const admin = sessions.createPlexSession(6, "a", "admin");
    const portal = sessions.createPlexSession(7, "p", "portal");

    sessions.deletePlexSessionsInScope("admin");

    assert.equal(sessions.getPlexSession(admin, "admin"), undefined);
    assert.equal(sessions.getPlexSession(portal, "portal")?.username, "p");
  });
});
