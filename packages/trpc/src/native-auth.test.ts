/**
 * The native apps' half of sign-in: a bearer token instead of a cookie, and a
 * handshake whose nonce and session travel in the response body.
 *
 * The property that matters is the separation. A browser's session must never
 * come back in a body, where page script could read it, so a handshake begun
 * by a browser can't be finished as a native one — and the reverse, so a nonce
 * that was only ever in a body can't be replayed as a cookie.
 */
import { describe, test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { JobsToken, registerJobs } from "@tinkerbell/jobs";
import { createTrpc } from "./index.ts";
import { t } from "./_base.ts";
import { createHandshakes } from "./handshake.ts";

delete process.env.TINKERBELL_DISABLE_AUTH;

const c = createTestContainer({ overrides: registerJobs });
after(() => c.dispose());

const deps = { ...c.resolve(ServicesToken), jobs: c.resolve(JobsToken) };
const { appRouter, portalRouter, createAdminContext, createPortalContext } = createTrpc(deps);
// The same deps object, so `perDeps` hands back the routers' own store.
const handshakes = createHandshakes(deps);
const { createPlexSession } = deps.sessions;
const { setConfig } = deps.config;

const OWNER_TOKEN = "plex-token-for-tests";

beforeEach(() => {
  handshakes.resetHandshakes();
  handshakes.resetRateLimits();
  setConfig("admin_auth_enabled", true);
  setConfig("global_plex_token", OWNER_TOKEN);
  setConfig("global_plex_owner_id", 42);
  setConfig("global_plex_owner_username", "owner");
  setConfig("global_plex_owner_token_hash", createHash("sha256").update(OWNER_TOKEN).digest("hex"));
});

function adminContext(headers: Record<string, string> = {}) {
  return createAdminContext({
    req: new Request("http://tinkerbell.test/api/trpc", { headers }),
    resHeaders: new Headers(),
  });
}

describe("bearer sessions", () => {
  test("an admin session sent as a bearer token signs the caller in", () => {
    const raw = createPlexSession(42, "owner", "admin");
    assert.equal(adminContext({ authorization: `Bearer ${raw}` }).session?.username, "owner");
  });

  test("an agent API key is not a bearer session", () => {
    assert.equal(adminContext({ authorization: `Bearer tbk_${"a".repeat(43)}` }).session, undefined);
  });

  test("a media token is not a bearer session", () => {
    const media = createPlexSession(42, "owner", "admin-media");
    assert.equal(adminContext({ authorization: `Bearer ${media}` }).session, undefined);
  });

  test("the cookie wins over a bearer header", () => {
    const other = createPlexSession(42, "owner", "portal");
    const raw = createPlexSession(42, "owner", "admin");
    const ctx = adminContext({ cookie: `tb_admin_session=${raw}`, authorization: `Bearer ${other}` });
    assert.equal(ctx.rawToken, raw);
  });

  test("the portal accepts its own session as a bearer token", () => {
    // `plexUserExists` gates the portal; without a synced user there's no session.
    const raw = createPlexSession(42, "owner", "portal");
    const ctx = createPortalContext({
      req: new Request("http://tinkerbell.test/api/trpc", { headers: { authorization: `Bearer ${raw}` } }),
      resHeaders: new Headers(),
    });
    assert.equal(ctx.rawToken, raw);
  });
});

describe("the native handshake", () => {
  test("a browser handshake can't be finished as a native one", async () => {
    const nonce = handshakes.createHandshake("admin", 1, "browser");
    const caller = t.createCallerFactory(appRouter)(adminContext());
    // `expired` comes back before plex.tv is asked anything.
    assert.equal((await caller.auth.poll({ handshake: nonce })).status, "expired");
  });

  test("a native handshake can't be finished from a cookie", async () => {
    const nonce = handshakes.createHandshake("admin", 1, "native");
    const caller = t.createCallerFactory(appRouter)(adminContext({ cookie: `tb_admin_handshake=${nonce}` }));
    assert.equal((await caller.auth.poll()).status, "expired");
  });

  test("an expired native poll sets no cookie", async () => {
    const resHeaders = new Headers();
    const ctx = { ...adminContext(), resHeaders };
    await t
      .createCallerFactory(appRouter)(ctx)
      .auth.poll({ handshake: "f".repeat(64) });
    assert.equal(resHeaders.get("set-cookie"), null);
  });

  test("a portal native handshake is no use to the admin router", async () => {
    const nonce = handshakes.createHandshake("portal", 1, "native");
    const caller = t.createCallerFactory(appRouter)(adminContext());
    assert.equal((await caller.auth.poll({ handshake: nonce })).status, "expired");
  });
});

describe("media tokens", () => {
  test("a signed-in admin gets one, and it isn't their session", async () => {
    const raw = createPlexSession(42, "owner", "admin");
    const caller = t.createCallerFactory(appRouter)(adminContext({ authorization: `Bearer ${raw}` }));
    const { token } = await caller.auth.mediaToken();
    assert.ok(token);
    assert.notEqual(token, raw);
    assert.equal(deps.sessions.getPlexSession(token, "admin-media")?.userId, 42);
  });

  test("logout takes the media token with it", async () => {
    const raw = createPlexSession(42, "owner", "admin");
    const media = createPlexSession(42, "owner", "admin-media");
    const caller = t.createCallerFactory(appRouter)(adminContext({ authorization: `Bearer ${raw}` }));
    await caller.auth.logout({ mediaToken: media });
    assert.equal(deps.sessions.getPlexSession(media, "admin-media"), undefined);
    assert.equal(deps.sessions.getPlexSession(raw, "admin"), undefined);
  });
});

describe("auth.server", () => {
  test("each router names itself, so the app can tell the two ports apart", async () => {
    const admin = await t.createCallerFactory(appRouter)(adminContext()).auth.server();
    const portalCaller = portalRouter.createCaller(
      createPortalContext({ req: new Request("http://tinkerbell.test/api/trpc"), resHeaders: new Headers() }),
    );
    const portal = await portalCaller.auth.server();
    assert.equal(admin.product, "tinkerbell-admin");
    assert.equal(portal.product, "tinkerbell-portal");
    assert.match(admin.version, /^\d+\.\d+\.\d+/);
  });
});
