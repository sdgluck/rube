/**
 * The portal's equivalent of `router-surface.test.ts`.
 *
 * The portal is the surface a shared user reaches, so two things need pinning:
 * that everything except the sign-in handshake and the two screens the login
 * page itself renders requires a session, and that the handshake cannot be
 * completed by a caller who didn't begin it. The second is the one that had a
 * hole — `auth.poll` used to take the plex.tv PIN id as an input, and plex.tv
 * hands a PIN's token to anyone who asks with the client id that minted it.
 */
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// As in `router-surface.test.ts`: `@tinkerbell/db` opens its SQLite file at
// import time, so point it somewhere disposable first.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "tinkerbell-portal-test-"));

/**
 * The complete public surface of the portal API. `personalizationStatus` and
 * `branding` are what the login screen renders itself from, and the three
 * handshake procedures are unauthenticated by definition. A shared user's own
 * data is never in here.
 */
const PUBLIC_PATHS = new Set(["personalizationStatus", "branding", "auth.start", "auth.poll", "auth.logout"]);

type PortalContext = import("./portal.router.ts").PortalContext;

let portalRouter: typeof import("./portal.router.ts").portalRouter;
let createHandshake: typeof import("./handshake.ts").createHandshake;

before(async () => {
  execFileSync(process.execPath, [join(import.meta.dirname, "..", "..", "db", "src", "migrate.ts")], {
    env: { ...process.env },
    stdio: "ignore",
  });
  ({ portalRouter } = await import("./portal.router.ts"));
  ({ createHandshake } = await import("./handshake.ts"));
});

function anonymousContext(): PortalContext {
  return {
    session: undefined,
    rawToken: undefined,
    resHeaders: new Headers(),
    secure: false,
    handshakeNonce: undefined,
    origin: "http://portal.tinkerbell.test",
    ip: "test",
  };
}

async function caller(ctx: Partial<PortalContext> = {}) {
  const { initTRPC } = await import("@trpc/server");
  const factory = initTRPC.context<PortalContext>().create();
  return factory.createCallerFactory(portalRouter)({ ...anonymousContext(), ...ctx });
}

/** The procedure map, keyed by dotted path the way tRPC stores it. */
function procedures(): Record<string, { _def: { inputs: unknown[] } }> {
  return portalRouter._def.procedures as unknown as Record<string, { _def: { inputs: unknown[] } }>;
}

describe("portal router surface", () => {
  test("every procedure outside the public list rejects a caller with no session", async () => {
    const client = await caller();
    const paths = Object.keys(procedures());
    assert.ok(paths.length > 5, `expected the full portal router, got ${paths.length} procedures`);

    const reachable: string[] = [];
    for (const path of paths) {
      if (PUBLIC_PATHS.has(path)) continue;
      const fn = path.split(".").reduce<never>((acc, key) => (acc as never)[key], client as never) as unknown as (
        input?: unknown,
      ) => Promise<unknown>;
      await fn(undefined).then(
        () => reachable.push(`${path} (resolved)`),
        (err: { code?: string }) => {
          if (err?.code !== "UNAUTHORIZED") reachable.push(`${path} (${err?.code ?? "unknown error"})`);
        },
      );
    }

    assert.deepEqual(
      reachable,
      [],
      `these portal procedures did not reject a caller with no session — use \`userProcedure\`, ` +
        `or add them to PUBLIC_PATHS if the login screen genuinely needs them:\n  ${reachable.join("\n  ")}`,
    );
  });

  test("the public list holds only the handshake and the login screen's own two queries", () => {
    for (const path of PUBLIC_PATHS) {
      assert.ok(
        path.startsWith("auth.") || path === "personalizationStatus" || path === "branding",
        `${path} is public but isn't part of the sign-in screen`,
      );
      assert.ok(path in procedures(), `${path} is listed as public but no longer exists`);
    }
  });

  test("poll accepts no PIN id from the caller", () => {
    // The regression this guards: an input schema here means a caller can name
    // the PIN to redeem, and plex.tv's ids are sequential — so polling around
    // the live range while somebody approves theirs collects their session.
    const proc = procedures()["auth.poll"];
    assert.deepEqual(proc._def.inputs, [], "auth.poll must take no input; the PIN id comes from the cookie");
  });

  test("start accepts no forwardUrl from the caller", () => {
    // Same shape of bug in the other direction: a caller-chosen return address
    // makes a genuine app.plex.tv link that lands the user on their page.
    const proc = procedures()["auth.start"];
    assert.deepEqual(proc._def.inputs, [], "auth.start must take no input; the return address is the server's");
  });

  test("poll refuses a caller with no handshake cookie instead of reaching plex.tv", async () => {
    const client = await caller();
    const res = await client.auth.poll();
    assert.equal(res.status, "expired");
  });

  test("poll refuses a nonce this process never issued", async () => {
    const client = await caller({ handshakeNonce: "a".repeat(64) });
    const res = await client.auth.poll();
    assert.equal(res.status, "expired");
  });

  test("a portal nonce cannot redeem an admin handshake", async () => {
    // The two scopes keep separate cookies, separate sessions and separate
    // plex.tv client ids; the handshake store is namespaced for the same
    // reason. A nonce minted for the admin flow is not a portal handshake.
    const adminNonce = createHandshake("admin", 4242);
    const client = await caller({ handshakeNonce: adminNonce });
    const res = await client.auth.poll();
    assert.equal(res.status, "expired");
  });
});
