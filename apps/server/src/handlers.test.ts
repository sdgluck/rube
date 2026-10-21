/**
 * The routing composition, over a real `node:http` server on port 0.
 *
 * `security.test.ts` and `auth.test.ts` already cover the parts — path
 * resolution, traversal rejection, build-asset detection, the image URL
 * builder, `isAdminRequest`. What none of them could reach was the *order* the
 * parts run in, because it lived at module scope in `server.ts` and importing
 * that file started a server and opened a database.
 *
 * So these are the arrangement questions, each of which is a two-line
 * composition of well-tested pieces, and each of which was unverified:
 *
 * - Does the admin gate actually run before every route family it is supposed
 *   to guard? A route added below the gate is safe; the same route added above
 *   it is a full bypass, and nothing said which side of the line it was on.
 * - Does `/api/plex-image` coerce a hostile upstream `Content-Type`? That
 *   branch is the anti-XSS control for a same-origin endpoint that streams
 *   bytes chosen by whatever the Plex URL points at.
 * - Does a missing hashed chunk 404, rather than being answered with
 *   `index.html` and a 200? The whole reason `sendStaleAsset` exists is that a
 *   200-with-HTML makes a stale client look like a corrupt build.
 * - Does the portal server refuse admin paths? The comment above it says the
 *   admin router is "intentionally NOT mounted"; that is a claim about a file,
 *   and this is the only thing that checks it stayed true.
 *
 * The route families themselves are faked here — what they *do* is tested
 * against a real container in `portability.test.ts` and `prerolls.test.ts`.
 * What is under test here is whether they are reached at all, and with what
 * around them.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { initTRPC } from "@trpc/server";

import { createAdminHandler, createPortalHandler } from "./handlers.ts";
import { guarded } from "./http.ts";

const t = initTRPC.context<Record<string, unknown>>().create();
const appRouter = t.router({ ping: t.procedure.query(() => "admin-pong") });
const portalRouter = t.router({ ping: t.procedure.query(() => "portal-pong") });

/** What the fake route families recorded, reset per test. */
let calls: string[] = [];
/** Flipped per test to make the gate refuse. */
let admin = true;
/** What each faked route family should do when reached. */
let prerollBehaviour: "miss" | "handle" | "throw" = "miss";
let portabilityBehaviour: "miss" | "handle" | "throw" = "miss";
let collectionBehaviour: "miss" | "handle" | "throw" = "miss";
/** The upstream the plex-image proxy will see. */
let upstream: () => Response = () => new Response("bytes", { headers: { "Content-Type": "image/png" } });

const dist = mkdtempSync(join(tmpdir(), "rube-dist-"));
const portalDist = mkdtempSync(join(tmpdir(), "rube-portal-dist-"));

let adminServer: Server;
let portalServer: Server;
let adminBase: string;
let portalBase: string;

function routeFake(name: string, behaviour: () => "miss" | "handle" | "throw") {
  return async (_req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    calls.push(`${name}:${url.pathname}`);
    const mode = behaviour();
    if (mode === "throw") throw new Error(`${name} exploded`);
    if (mode === "miss") return false;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ handled: name }));
    return true;
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

/** Every test-side fetch needs a deadline — see scripts/check-fetch.mjs. */
function get(base: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, { signal: AbortSignal.timeout(5_000), ...init });
}

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Parameters<typeof guarded>[0];

before(async () => {
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>admin</title>");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "assets", "main-abc123.js"), "console.log(1)");
  writeFileSync(join(portalDist, "index.html"), "<!doctype html><title>portal</title>");

  adminServer = createServer(
    guarded(
      silentLog,
      createAdminHandler({
        rejectIfNotAdmin: (_req, res) => {
          if (admin) return false;
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Sign in" }));
          return true;
        },
        getConfig: ((key: string) =>
          key === "global_plex_url" ? "http://plex.invalid" : key === "global_plex_token" ? "tok" : undefined) as never,
        handlePrerollRoute: routeFake("preroll", () => prerollBehaviour),
        handlePortabilityRoute: routeFake("portability", () => portabilityBehaviour),
        handleCollectionRoute: routeFake("collection", () => collectionBehaviour),
        appRouter: appRouter as never,
        createAdminContext: (() => ({ scope: { dispose: async () => {} } })) as never,
        handleAgentRequest: async (req) => {
          calls.push(`agent:${new URL(req.url).pathname}`);
          return new Response(JSON.stringify({ handled: "agent" }), {
            headers: { "Content-Type": "application/json" },
          });
        },
        distDir: dist,
        fetchImpl: (async () => upstream()) as typeof fetch,
      }),
    ),
  );
  portalServer = createServer(
    guarded(
      silentLog,
      createPortalHandler({
        portalRouter: portalRouter as never,
        createPortalContext: (() => ({})) as never,
        portalDistDir: portalDist,
        getConfig: ((key: string) =>
          key === "global_plex_url" ? "http://plex.invalid" : key === "global_plex_token" ? "tok" : undefined) as never,
        posterThumb: (ratingKey, sig) => (ratingKey === "42" && sig === "good" ? "/library/metadata/42/thumb/1" : null),
        fetchImpl: (async (url: string) => {
          calls.push(`poster:${url}`);
          return upstream();
        }) as typeof fetch,
      }),
    ),
  );

  adminBase = await listen(adminServer);
  portalBase = await listen(portalServer);
});

after(() => {
  adminServer.close();
  adminServer.closeAllConnections();
  portalServer.close();
  portalServer.closeAllConnections();
  rmSync(dist, { recursive: true, force: true });
  rmSync(portalDist, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  admin = true;
  prerollBehaviour = "miss";
  portabilityBehaviour = "miss";
  collectionBehaviour = "miss";
  upstream = () => new Response("bytes", { headers: { "Content-Type": "image/png" } });
});

describe("the admin gate", () => {
  const GATED = [
    "/api/plex-image?path=/library/1/thumb",
    "/api/prerolls/upload",
    "/api/portability/export",
    "/api/backups/rube-1.db.gz",
    "/api/collections/123/poster",
  ];

  test("every gated path answers 401 to a non-admin", async () => {
    admin = false;
    for (const path of GATED) {
      const res = await get(adminBase, path);
      assert.equal(res.status, 401, `${path} was not gated`);
      await res.text();
    }
  });

  test("the gate runs before the route handler, not after", async () => {
    // The distinction that matters: a route that runs and *then* checks has
    // already read the body, written the file, or started the export.
    admin = false;
    prerollBehaviour = "handle";
    portabilityBehaviour = "handle";
    collectionBehaviour = "handle";

    for (const path of GATED) await (await get(adminBase, path)).text();

    assert.deepEqual(calls, [], "no route family was even entered");
  });

  test("an admin reaches the route families", async () => {
    prerollBehaviour = "handle";
    const res = await get(adminBase, "/api/prerolls/play/abc");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { handled: "preroll" });
  });

  test("the agent API is not behind the cookie gate — it authenticates by key", async () => {
    // An AI client has no Plex session; if the cookie gate ran first, no key
    // could ever be presented. The module refuses keyless calls itself, which
    // `@rube/agent-api`'s own tests cover.
    admin = false;
    for (const path of ["/mcp", "/api/v1", "/api/v1/tools/get_overview"]) {
      const res = await get(adminBase, path);
      assert.equal(res.status, 200, path);
      assert.deepEqual(await res.json(), { handled: "agent" });
    }
    assert.deepEqual(calls, ["agent:/mcp", "agent:/api/v1", "agent:/api/v1/tools/get_overview"]);
  });

  test("the tRPC surface is not gated here — it does its own auth", async () => {
    // Deliberate: the tRPC gate lives in `_base.ts`'s `requireAdmin` middleware
    // so it can answer UNAUTHORIZED in the client's own error shape. A blanket
    // HTTP gate here would break the sign-in handshake, which is public.
    admin = false;
    const res = await get(adminBase, "/api/trpc/ping");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /admin-pong/);
  });
});

describe("route family fall-through", () => {
  test("a preroll path the family declines falls through to the SPA", async () => {
    // The families return false for a path they don't own, and the handler must
    // carry on rather than 404 — that is how `/api/prerolls/anything-else`
    // reaches the SPA router.
    const res = await get(adminBase, "/api/prerolls/unknown");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>admin<\/title>/);
  });

  test("a throwing route family answers 500 as JSON, not an empty socket", async () => {
    prerollBehaviour = "throw";
    const res = await get(adminBase, "/api/prerolls/upload");
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "preroll exploded" });
  });

  test("a throwing portability route reports the message", async () => {
    portabilityBehaviour = "throw";
    const res = await get(adminBase, "/api/portability/apply");
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "portability exploded" });
  });

  test("a throwing collection route reports the message", async () => {
    collectionBehaviour = "throw";
    const res = await get(adminBase, "/api/collections/1/poster");
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "collection exploded" });
  });

  test("backups and portability share one family", async () => {
    portabilityBehaviour = "handle";
    await (await get(adminBase, "/api/backups/x.db.gz")).text();
    await (await get(adminBase, "/api/portability/export")).text();
    assert.deepEqual(calls, ["portability:/api/backups/x.db.gz", "portability:/api/portability/export"]);
  });
});

describe("the Plex image proxy", () => {
  test("passes an allowed image type through unchanged", async () => {
    upstream = () => new Response("bytes", { headers: { "Content-Type": "image/webp" } });
    const res = await get(adminBase, "/api/plex-image?path=/library/1/thumb");

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/webp");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await res.text(), "bytes");
  });

  test("coerces an upstream text/html to an opaque download", async () => {
    // The control this endpoint exists to have: a hostile or compromised Plex
    // answering with HTML would otherwise turn a same-origin URL into stored
    // XSS against the SPA.
    upstream = () => new Response("<script>alert(1)</script>", { headers: { "Content-Type": "text/html" } });
    const res = await get(adminBase, "/api/plex-image?path=/library/1/thumb");

    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    await res.text();
  });

  test("coerces anything else outside the allow-list, including svg", async () => {
    // SVG is an image and also a script host, which is why it is not on the
    // list even though the others are.
    for (const type of ["image/svg+xml", "application/javascript", "text/plain", ""]) {
      upstream = () => new Response("x", { headers: type ? { "Content-Type": type } : {} });
      const res = await get(adminBase, "/api/plex-image?path=/library/1/thumb");
      assert.equal(res.headers.get("content-type"), "application/octet-stream", `${type} was passed through`);
      await res.text();
    }
  });

  test("a missing path is a 400 rather than a request to nowhere", async () => {
    const res = await get(adminBase, "/api/plex-image");
    assert.equal(res.status, 400);
    await res.text();
  });

  test("an upstream failure is forwarded as its own status", async () => {
    upstream = () => new Response("nope", { status: 404 });
    const res = await get(adminBase, "/api/plex-image?path=/library/1/thumb");
    assert.equal(res.status, 404);
    await res.text();
  });

  test("an upstream that throws becomes a 502", async () => {
    upstream = () => {
      throw new Error("connect ECONNREFUSED");
    };
    const res = await get(adminBase, "/api/plex-image?path=/library/1/thumb");
    assert.equal(res.status, 502);
    await res.text();
  });
});

describe("static files and the SPA fallback", () => {
  test("serves a real asset with its own content type", async () => {
    const res = await get(adminBase, "/assets/main-abc123.js");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/javascript");
    assert.equal(await res.text(), "console.log(1)");
  });

  test("an app route falls back to index.html", async () => {
    const res = await get(adminBase, "/rules/123/runs");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>admin<\/title>/);
  });

  test("a missing build asset 404s with no-store rather than serving the SPA", async () => {
    // The failure this prevents: a client running against a build we no longer
    // have asks for a chunk, gets `index.html` with a 200 and a JS content
    // type, and the browser reports a syntax error in a file that looks fine.
    const res = await get(adminBase, "/assets/main-deadbee.js");

    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
    assert.match(await res.text(), /reload it/);
  });

  test("a traversal attempt does not escape the dist directory", async () => {
    // `resolveStaticPath` is unit-tested; this is the composition — a rejected
    // path must fall through to the SPA, not to the filesystem.
    for (const path of ["/../../package.json", "/..%2f..%2fpackage.json", "/assets/../../package.json"]) {
      const res = await get(adminBase, path);
      const body = await res.text();
      assert.doesNotMatch(body, /"name":\s*"@rube/, `${path} escaped`);
    }
  });
});

describe("the portal server", () => {
  test("serves its own tRPC router", async () => {
    const res = await get(portalBase, "/api/trpc/ping");
    assert.match(await res.text(), /portal-pong/);
  });

  test("does not mount the admin router", async () => {
    // The claim in `server.ts`'s comment. The portal port may be exposed
    // publicly, so an admin procedure reachable here is a full compromise.
    const res = await get(portalBase, "/api/trpc/ping");
    const body = await res.text();
    assert.doesNotMatch(body, /admin-pong/);
  });

  test("an admin-only API path is a 404, not the SPA", async () => {
    // Answering `index.html` with a 200 made a wrong port look like a broken
    // image rather than a wrong port.
    for (const path of [
      "/api/plex-image?path=/x",
      "/api/prerolls/play/1",
      "/api/portability/export",
      "/api/anything",
    ]) {
      const res = await get(portalBase, path);
      assert.equal(res.status, 404, `${path} was not a 404`);
      assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
      await res.text();
    }
  });

  test("serves a movie-match poster only on a valid signature", async () => {
    const ok = await get(portalBase, "/api/match/poster/42?sig=good");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    await ok.text();
    // The thumb is looked up from the signed key; the caller never names a Plex path.
    assert.ok(calls.includes("poster:http://plex.invalid/library/metadata/42/thumb/1?X-Plex-Token=tok"));

    for (const path of [
      "/api/match/poster/42",
      "/api/match/poster/42?sig=bad",
      "/api/match/poster/43?sig=good",
      "/api/match/poster/%E0%A4%A?sig=good",
    ]) {
      const res = await get(portalBase, path);
      assert.equal(res.status, 404, `${path} was not refused`);
      await res.text();
    }
  });

  test("serves the portal SPA, never the admin one", async () => {
    const res = await get(portalBase, "/preferences");
    assert.match(await res.text(), /<title>portal<\/title>/);
  });

  test("a missing build asset 404s here too", async () => {
    const res = await get(portalBase, "/assets/portal-deadbee.js");
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "no-store");
    await res.text();
  });
});

describe("no CORS", () => {
  // The Capacitor apps were the only cross-origin callers, and they are gone.
  // The native app sends no `Origin`, so neither server answers CORS for
  // anyone — including the two origins the old apps used.
  test("no origin gets CORS headers from either server, the retired apps' included", async () => {
    const origins = ["capacitor://app.rube", "https://portal.rube", "https://evil.example"];
    for (const base of [adminBase, portalBase]) {
      for (const origin of origins) {
        const res = await get(base, "/api/trpc/ping", { headers: { Origin: origin } });
        assert.equal(res.headers.get("access-control-allow-origin"), null, `${base} ${origin}`);
        await res.text();
      }
    }
  });
});
