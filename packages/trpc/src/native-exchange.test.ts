/**
 * `auth.exchange`: the native app's sign-in from a Plex token it got itself.
 *
 * The app runs the plex.tv PIN flow once and offers the result to the portal
 * and to the admin server. Each must check it on its own terms — the admin
 * allow-list, the portal's shared-user list — and neither must accept the
 * session the other minted. A browser must never get a session in a body.
 *
 * Against the mock plex.tv rather than a `fetch` stub, so the `/user` lookup's
 * URL and headers are the real ones.
 */
import { describe, test, after, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken, plexUsers } from "@tinkerbell/db";
import { JobsToken, registerJobs } from "@tinkerbell/jobs";
import { startMockPlexTv, type MockPlexTvServer } from "@tinkerbell/test-support/plex-tv";
import { createTrpc } from "./index.ts";
import { t } from "./_base.ts";
import { createHandshakes } from "./handshake.ts";

delete process.env.TINKERBELL_DISABLE_AUTH;

const c = createTestContainer({ overrides: registerJobs });
after(() => c.dispose());

const deps = { ...c.resolve(ServicesToken), jobs: c.resolve(JobsToken) };
const { appRouter, portalRouter, createAdminContext, createPortalContext } = createTrpc(deps);
const handshakes = createHandshakes(deps);
const { setConfig } = deps.config;
const { getPlexSession } = deps.sessions;
const db = c.resolve(DbToken);

const OWNER = { id: 42, username: "owner" };
const SHARED = { id: 7, username: "alice" };
const STRANGER = { id: 99, username: "mallory" };
const OWNER_TOKEN = "plex-token-for-tests";

let plexTv: MockPlexTvServer;
before(async () => {
  plexTv = await startMockPlexTv({ defaultAccount: OWNER });
  process.env.TINKERBELL_PLEX_TV_URL = plexTv.origin;
  db.insert(plexUsers).values({ userId: SHARED.id, username: SHARED.username, label: "alice", syncedAt: 0 }).run();
});
after(async () => {
  delete process.env.TINKERBELL_PLEX_TV_URL;
  await plexTv.close();
});

beforeEach(() => {
  handshakes.resetRateLimits();
  setConfig("admin_auth_enabled", true);
  setConfig("global_plex_token", OWNER_TOKEN);
  setConfig("global_plex_owner_id", OWNER.id);
  setConfig("global_plex_owner_username", OWNER.username);
  setConfig("global_plex_owner_token_hash", createHash("sha256").update(OWNER_TOKEN).digest("hex"));
});

function admin(headers: Record<string, string> = {}) {
  const ctx = createAdminContext({
    req: new Request("http://tinkerbell.test/api/trpc", { method: "POST", headers }),
    resHeaders: new Headers(),
  });
  return { ctx, caller: t.createCallerFactory(appRouter)(ctx) };
}

function portal(headers: Record<string, string> = {}) {
  const ctx = createPortalContext({
    req: new Request("http://tinkerbell.test/api/trpc", { method: "POST", headers }),
    resHeaders: new Headers(),
  });
  return { ctx, caller: portalRouter.createCaller(ctx) };
}

describe("admin auth.exchange", () => {
  test("the owner's Plex token becomes an admin session, returned in the body", async () => {
    const { ctx, caller } = admin();
    const result = await caller.auth.exchange({ plexToken: plexTv.tokenFor(OWNER) });
    assert.equal(result.status, "ok");
    assert.ok(result.status === "ok" && result.token);
    assert.equal(getPlexSession(result.token, "admin")?.userId, OWNER.id);
    // No cookie: the app keeps the token itself.
    assert.equal(ctx.resHeaders.get("set-cookie"), null);
  });

  test("someone not on the allow-list is refused, and the refusal is recorded", async () => {
    const { caller } = admin();
    await assert.rejects(caller.auth.exchange({ plexToken: plexTv.tokenFor(STRANGER) }), { code: "FORBIDDEN" });
    assert.ok(deps.events.getEventTypes().includes("auth.denied"));
  });

  test("a token plex.tv doesn't recognise is not a session", async () => {
    const { caller } = admin();
    // UNAUTHORIZED, not the 500 an unmapped plex.tv 401 became: the app has to
    // read it as "sign in again", not "this server is broken".
    await assert.rejects(caller.auth.exchange({ plexToken: "not-a-real-token" }), { code: "UNAUTHORIZED" });
  });

  test("with admin auth off there is nothing to sign in to", async () => {
    setConfig("admin_auth_enabled", false);
    const { caller } = admin();
    assert.deepEqual(await caller.auth.exchange({ plexToken: plexTv.tokenFor(OWNER) }), { status: "open" });
  });

  test("a browser can't exchange, so no page script reads a session", async () => {
    const browsers: Record<string, string>[] = [{ origin: "http://evil.test" }, { "sec-fetch-site": "same-origin" }];
    for (const headers of browsers) {
      const { caller } = admin(headers);
      await assert.rejects(caller.auth.exchange({ plexToken: plexTv.tokenFor(OWNER) }), { code: "FORBIDDEN" });
    }
  });

  test("it is rate-limited like the handshake", async () => {
    const { caller } = admin();
    const token = plexTv.tokenFor(OWNER);
    for (let i = 0; i < 60; i++) await caller.auth.exchange({ plexToken: token });
    await assert.rejects(caller.auth.exchange({ plexToken: token }), { code: "TOO_MANY_REQUESTS" });
  });

  test("the rate-limit window closes even when the wall clock stands still", () => {
    // The native dev server freezes `Date`; a window timed on it never ended.
    const frozen = mock.method(Date, "now", () => 1_700_000_000_000);
    let elapsed = 0;
    const clock = mock.method(performance, "now", () => elapsed);
    try {
      for (let i = 0; i < 60; i++) handshakes.rateLimit("10.0.0.9");
      assert.throws(() => handshakes.rateLimit("10.0.0.9"), { code: "TOO_MANY_REQUESTS" });
      elapsed += 60_001;
      assert.doesNotThrow(() => handshakes.rateLimit("10.0.0.9"));
    } finally {
      frozen.mock.restore();
      clock.mock.restore();
    }
  });
});

describe("portal auth.exchange", () => {
  test("a shared user's Plex token becomes a portal session", async () => {
    const { caller } = portal();
    const result = await caller.auth.exchange({ plexToken: plexTv.tokenFor(SHARED) });
    assert.equal(result.username, SHARED.username);
    assert.equal(getPlexSession(result.token, "portal")?.userId, SHARED.id);
  });

  test("someone who isn't a user of this server is refused", async () => {
    const { caller } = portal();
    await assert.rejects(caller.auth.exchange({ plexToken: plexTv.tokenFor(STRANGER) }), { code: "FORBIDDEN" });
  });

  test("a token plex.tv doesn't recognise is UNAUTHORIZED, not a server error", async () => {
    const { caller } = portal();
    await assert.rejects(caller.auth.exchange({ plexToken: "not-a-real-token" }), { code: "UNAUTHORIZED" });
  });

  test("a browser can't exchange", async () => {
    const { caller } = portal({ origin: "http://evil.test" });
    await assert.rejects(caller.auth.exchange({ plexToken: plexTv.tokenFor(SHARED) }), { code: "FORBIDDEN" });
  });
});

describe("the two servers stay separate", () => {
  test("a portal session from exchange is no use to the admin router, and vice versa", async () => {
    // The owner is a shared user too, so both servers will mint a session.
    db.insert(plexUsers).values({ userId: OWNER.id, username: OWNER.username, label: "owner", syncedAt: 0 }).run();
    const plexToken = plexTv.tokenFor(OWNER);
    const fromPortal = await portal().caller.auth.exchange({ plexToken });
    const fromAdmin = await admin().caller.auth.exchange({ plexToken });
    assert.ok(fromAdmin.status === "ok");

    assert.equal(admin({ authorization: `Bearer ${fromPortal.token}` }).ctx.session, undefined);
    assert.equal(portal({ authorization: `Bearer ${fromAdmin.token}` }).ctx.session, undefined);
    assert.equal(admin({ authorization: `Bearer ${fromAdmin.token}` }).ctx.session?.userId, OWNER.id);
  });

  test("auth.server reports the capability, and only the admin names the portal", async () => {
    setConfig("user_app_public_url", "https://portal.example.test");
    const adminInfo = await admin().caller.auth.server();
    const portalInfo = await portal().caller.auth.server();
    assert.deepEqual(adminInfo.capabilities, ["exchange"]);
    assert.deepEqual(portalInfo.capabilities, ["exchange"]);
    assert.equal(adminInfo.portalUrl, "https://portal.example.test");
    assert.equal(adminInfo.authRequired, true);
    assert.equal("portalUrl" in portalInfo, false);
  });
});
