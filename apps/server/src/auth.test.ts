/**
 * The gate on the routes that never reach tRPC. `/api/plex-image` proxies
 * Plex thumbs with the server's own token and `/api/prerolls/…` reads and
 * writes files, so both have to refuse anonymous callers exactly as the tRPC
 * middleware does.
 */
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { clientIp, createAuth } from "./auth.ts";

delete process.env.TINKERBELL_DISABLE_AUTH;

const c = createTestContainer();
after(() => c.dispose());

const services = c.resolve(ServicesToken);
const auth = createAuth(services);
const core = { ...services.config, ...services.sessions, ...services.adminAuth };

/** The parts of an IncomingMessage the gate actually reads. */
function request(
  cookie?: string,
  extra: { authorization?: string; method?: string; url?: string } = {},
): IncomingMessage {
  return {
    headers: { ...(cookie ? { cookie } : {}), ...(extra.authorization ? { authorization: extra.authorization } : {}) },
    method: extra.method ?? "GET",
    url: extra.url ?? "/api/plex-image?path=/x",
    socket: { remoteAddress: "10.0.0.1" },
  } as unknown as IncomingMessage;
}

const OWNER_TOKEN = "plex-token-for-tests";

beforeEach(() => {
  delete process.env.TINKERBELL_DISABLE_AUTH;
  core.setConfig("admin_auth_enabled", true);
  // Owner resolution is cached in config; the request path never calls out to
  // plex.tv, so seeding it here is exactly what a resolved install looks like.
  // The cached owner is only trusted while it is bound to the token it was
  // resolved from, so the hash has to be seeded with it.
  core.setConfig("global_plex_token", OWNER_TOKEN);
  core.setConfig("global_plex_owner_id", 42);
  core.setConfig("global_plex_owner_username", "owner");
  core.setConfig("global_plex_owner_token_hash", createHash("sha256").update(OWNER_TOKEN).digest("hex"));
  core.setConfig("admin_allowed_user_ids", []);
});

describe("isAdminRequest", () => {
  test("refuses a request with no cookie", () => {
    assert.equal(auth.isAdminRequest(request()), false);
  });

  test("refuses a garbage cookie", () => {
    assert.equal(auth.isAdminRequest(request("tb_admin_session=not-a-real-token")), false);
  });

  test("admits the owner's admin session", () => {
    const raw = core.createPlexSession(42, "owner", "admin");
    assert.equal(auth.isAdminRequest(request(`tb_admin_session=${raw}`)), true);
  });

  test("refuses a portal session presented as an admin cookie", () => {
    const raw = core.createPlexSession(42, "owner", "portal");
    assert.equal(auth.isAdminRequest(request(`tb_admin_session=${raw}`)), false);
  });

  test("refuses an admin session belonging to an account that isn't an admin", () => {
    // A stale session — the account was allow-listed when it signed in and
    // isn't any more. It must stop working now, not at expiry.
    const raw = core.createPlexSession(999, "someone-else", "admin");
    assert.equal(auth.isAdminRequest(request(`tb_admin_session=${raw}`)), false);
  });

  test("admits an allow-listed second admin", () => {
    core.setConfig("admin_allowed_user_ids", [777]);
    const raw = core.createPlexSession(777, "deputy", "admin");
    assert.equal(auth.isAdminRequest(request(`tb_admin_session=${raw}`)), true);
  });

  test("refuses the owner once the Plex token it was resolved from has changed", () => {
    const raw = core.createPlexSession(42, "owner", "admin");
    // A rotated token may belong to a different account entirely, so the
    // cached owner id stops being evidence of anything.
    core.setConfig("global_plex_token", "a-different-token");
    assert.equal(auth.isAdminRequest(request(`tb_admin_session=${raw}`)), false);
  });

  test("refuses an owner id that was never bound to a token", () => {
    const raw = core.createPlexSession(42, "owner", "admin");
    // `resolveOwner` always writes the id and the hash together, so an id
    // standing alone was written some other way — fail closed rather than
    // treat it as a standing admin grant.
    core.deleteConfig("global_plex_owner_token_hash");
    assert.equal(auth.isAdminRequest(request(`tb_admin_session=${raw}`)), false);
  });

  test("admits everyone when auth is switched off — an upgrade changes nothing", () => {
    core.setConfig("admin_auth_enabled", false);
    assert.equal(auth.isAdminRequest(request()), true);
  });

  test("TINKERBELL_DISABLE_AUTH bypasses the gate", () => {
    process.env.TINKERBELL_DISABLE_AUTH = "1";
    assert.equal(auth.isAdminRequest(request()), true);
  });
});

describe("clientIp", () => {
  test("prefers the first forwarded hop", () => {
    const req = {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.2" },
      socket: { remoteAddress: "10.0.0.1" },
    } as unknown as IncomingMessage;
    assert.equal(clientIp(req), "203.0.113.7");
  });

  test("falls back to the socket address", () => {
    assert.equal(clientIp(request()), "10.0.0.1");
  });
});

describe("isAdminRequest for the native app", () => {
  test("admits the owner's admin session as a bearer token", () => {
    const raw = core.createPlexSession(42, "owner", "admin");
    assert.equal(auth.isAdminRequest(request(undefined, { authorization: `Bearer ${raw}` })), true);
  });

  test("refuses a portal session as a bearer token", () => {
    const raw = core.createPlexSession(42, "owner", "portal");
    assert.equal(auth.isAdminRequest(request(undefined, { authorization: `Bearer ${raw}` })), false);
  });

  test("refuses the real session token in the query string", () => {
    const raw = core.createPlexSession(42, "owner", "admin");
    assert.equal(auth.isAdminRequest(request(undefined, { url: `/api/plex-image?access_token=${raw}` })), false);
  });
});
