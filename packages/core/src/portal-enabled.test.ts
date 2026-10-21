/**
 * Which switches keep the portal's port open.
 *
 * It used to be personalization alone, which meant the two portal features that
 * have nothing to do with personalization — the warning before a film is
 * deleted, and subscribing to a digest — were unreachable unless the admin also
 * turned on the scheme that relabels every item in the library. Subscribing was
 * worse than unreachable: the portal is the only place to set a digest address,
 * so a closed port made the admin-side digest settings unusable by construction.
 */
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "@rube/db/test-db";
import { createConfigStore } from "./config.ts";

const testDb = createTestDb("rube-portal-enabled-test-");
after(testDb.dispose);

const { getConfig, setConfig, deleteConfig, portalShouldRun } = createConfigStore({
  db: testDb.db,
  recordChange: () => {},
});

beforeEach(() => {
  deleteConfig("global_personalized_sharing");
  deleteConfig("cleanup_enabled");
  deleteConfig("global_smtp");
  deleteConfig("match_enabled");
});

describe("portalShouldRun", () => {
  test("a default install runs no portal", () => {
    assert.equal(portalShouldRun(), false);
  });

  test("personalization opens it, mid-flip included", () => {
    // The port must not blink while the enable job is working, and the portal's
    // own "personalization isn't on yet" banner needs the port open to be seen.
    for (const status of ["enabling", "enabled", "disabling"] as const) {
      setConfig("global_personalized_sharing", { status });
      assert.equal(portalShouldRun(), true, status);
    }
    setConfig("global_personalized_sharing", { status: "disabled" });
    assert.equal(portalShouldRun(), false);
  });

  test("cleanup being on opens it, so people can be warned", () => {
    setConfig("cleanup_enabled", true);
    assert.equal(portalShouldRun(), true);
    setConfig("cleanup_enabled", false);
    assert.equal(portalShouldRun(), false);
  });

  test("configured SMTP opens it, so a digest can be subscribed to", () => {
    setConfig("global_smtp", {
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "",
      password: "",
      from: "",
      to: "",
    });
    assert.equal(portalShouldRun(), true);
    // A blank host is not configured SMTP.
    setConfig("global_smtp", { host: "", port: 587, secure: false, user: "", password: "", from: "", to: "" });
    assert.equal(portalShouldRun(), false);
    assert.ok(getConfig("global_smtp"), "the row still exists — it is the host that decides");
  });

  test("movie match opens it, since its rooms are the portal's", () => {
    setConfig("match_enabled", true);
    assert.equal(portalShouldRun(), true);
    setConfig("match_enabled", false);
    assert.equal(portalShouldRun(), false);
  });
});
