/**
 * The gate on the routes that never reach tRPC. `/api/plex-image` proxies
 * Plex thumbs with the server's own token and `/api/prerolls/…` reads and
 * writes files, so both have to refuse anonymous callers exactly as the tRPC
 * middleware does.
 */
import { describe, test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "tinkerbell-server-auth-test-"));
delete process.env.TINKERBELL_DISABLE_AUTH;

let auth: typeof import("./auth.ts");
let core: typeof import("@tinkerbell/core");

/** The parts of an IncomingMessage the gate actually reads. */
function request(cookie?: string): IncomingMessage {
  return {
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "10.0.0.1" },
  } as unknown as IncomingMessage;
}

before(async () => {
  execFileSync(process.execPath, [join(import.meta.dirname, "..", "..", "..", "packages", "db", "src", "migrate.ts")], {
    env: { ...process.env },
    stdio: "ignore",
  });
  auth = await import("./auth.ts");
  core = await import("@tinkerbell/core");
});

beforeEach(() => {
  delete process.env.TINKERBELL_DISABLE_AUTH;
  core.setConfig("admin_auth_enabled", true);
  // Owner resolution is cached in config; the request path never calls out to
  // plex.tv, so seeding it here is exactly what a resolved install looks like.
  core.setConfig("global_plex_owner_id", 42);
  core.setConfig("global_plex_owner_username", "owner");
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
    assert.equal(auth.clientIp(req), "203.0.113.7");
  });

  test("falls back to the socket address", () => {
    assert.equal(auth.clientIp(request()), "10.0.0.1");
  });
});
