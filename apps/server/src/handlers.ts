/**
 * The two request handlers, as functions of their dependencies.
 *
 * They used to live at module scope in `server.ts`, alongside
 * `buildContainer()`, `createServer()` and a `main()` that listens — so
 * importing the module to test a route started a server, opened a database and
 * bound two ports. The result was that 407 lines of routing had no tests at
 * all, while the pure helpers they compose (`resolveStaticPath`, `isBuildAsset`,
 * `buildPlexImageUrl`, `isAdminRequest`) were tested thoroughly.
 *
 * That split matters, because the bugs live in the composition rather than in
 * the helpers: whether the admin gate actually runs before the portability
 * routes, whether a missing hashed chunk 404s instead of being answered with
 * `index.html` and a 200, whether the portal really doesn't serve admin paths.
 * Each of those is a two-line arrangement of well-tested parts, and each was
 * unverified.
 *
 * Nothing here decides policy. The gate, the path resolution and the image URL
 * construction all still live where they did; this module only says in which
 * order they run.
 */
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { isAgentApiPath } from "@rube/agent-api";
import type { Services } from "@rube/composition";
import type { createTrpc } from "@rube/trpc";
import { buildPlexImageUrl, isBuildAsset, resolveStaticPath } from "./security.ts";
import { clientIp } from "./auth.ts";
import { sendFetchResponse, toFetchRequest } from "./http.ts";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

export async function serveStatic(res: ServerResponse, filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Content-Length": content.length,
    });
    res.end(content);
    return true;
  } catch {
    // ENOENT, EACCES, EISDIR — caller treats `false` as "didn't serve" and
    // falls back to the SPA index. Headers haven't been written yet when
    // we hit this path so the fallback can still write a 200.
    return false;
  }
}

/**
 * A hashed chunk that isn't on disk is a client running against a build we no
 * longer have. 404 rather than the SPA index, and say so in the body — the
 * message ends up in a browser console, which is where whoever is debugging a
 * blank page will be looking.
 */
export function sendStaleAsset(res: ServerResponse): void {
  const body = "This build asset no longer exists. The app has been updated since this page loaded — reload it.\n";
  res.writeHead(404, {
    "Content-Type": "text/plain",
    "Content-Length": Buffer.byteLength(body),
    // Never let a proxy or the browser hold on to the miss: the reload that
    // fixes it fetches a fresh index.html through the same caches.
    "Cache-Control": "no-store",
  });
  res.end(body);
}

/**
 * Stream one Plex image to the browser — the admin's `/api/plex-image` and the
 * portal's movie-match posters both come through here.
 */
async function proxyPlexImage(res: ServerResponse, imageUrl: URL, fetchImpl: typeof fetch): Promise<void> {
  try {
    const pRes = await fetchImpl(imageUrl.toString(), { signal: AbortSignal.timeout(10000) });
    if (!pRes.ok || !pRes.body) {
      res.writeHead(pRes.status);
      res.end();
      return;
    }
    // Don't trust the upstream MIME — a hostile/compromised Plex could
    // return text/html and turn this same-origin endpoint into an XSS
    // vector against the SPA. Coerce anything outside the allow-list
    // to an opaque download so the browser won't parse it.
    const upstream = pRes.headers.get("Content-Type") ?? "";
    const mime = ALLOWED_IMAGE_MIME.has(upstream) ? upstream : "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400",
    });
    // `pipeline` propagates backpressure and cancels the upstream reader
    // on error/abort, so we don't need an explicit reader.cancel().
    await pipeline(Readable.fromWeb(pRes.body as never), res);
  } catch {
    // Headers may already have been sent if the stream broke mid-flight.
    if (!res.headersSent) res.writeHead(502);
    res.end();
  }
}

type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;

/**
 * Derived from the real factory rather than restated, so a change to a router
 * or a context shape is a compile error here instead of a silent widening.
 */
type Trpc = ReturnType<typeof createTrpc>;

export interface AdminHandlerDeps {
  /** Writes a 401 and returns true when the caller isn't an admin. */
  rejectIfNotAdmin: (req: IncomingMessage, res: ServerResponse) => boolean;
  getConfig: Services["config"]["getConfig"];
  handlePrerollRoute: RouteHandler;
  handlePortabilityRoute: RouteHandler;
  handleCollectionRoute: RouteHandler;
  appRouter: Trpc["appRouter"];
  createAdminContext: Trpc["createAdminContext"];
  /** `/mcp` and `/api/v1` — see `@rube/agent-api`. Authenticates by API key, not cookie. */
  handleAgentRequest: (req: Request) => Promise<Response>;
  distDir: string;
  /** Injectable for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
}

export function createAdminHandler(deps: AdminHandlerDeps) {
  const {
    rejectIfNotAdmin,
    getConfig,
    handlePrerollRoute,
    handlePortabilityRoute,
    handleCollectionRoute,
    appRouter,
    createAdminContext,
    handleAgentRequest,
    distDir,
    fetchImpl = fetch,
  } = deps;

  return async function handleAdminRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const path = url.pathname;

    // Plex image proxy. Gated: it fetches arbitrary thumbs using the server's
    // own Plex token, so leaving it open would hand an anonymous caller a
    // readable window onto the library even with the tRPC API locked.
    if (path === "/api/plex-image") {
      if (rejectIfNotAdmin(req, res)) return;
      const imageUrl = buildPlexImageUrl({
        thumbPath: url.searchParams.get("path"),
        plexUrl: getConfig("global_plex_url"),
        plexToken: getConfig("global_plex_token"),
      });
      if (!imageUrl) {
        res.writeHead(400);
        res.end();
        return;
      }
      await proxyPlexImage(res, imageUrl, fetchImpl);
      return;
    }

    // Preroll upload/playback — streaming routes that tRPC's batch link can't
    // carry. Returns false when the path isn't one of them.
    // Gated in full, upload and playback alike. Plex never fetches prerolls over
    // HTTP — it reads them from the shared filesystem path (`prerolls_plex_path`),
    // so these routes only ever serve the admin SPA.
    if (path.startsWith("/api/prerolls/")) {
      if (rejectIfNotAdmin(req, res)) return;
      try {
        if (await handlePrerollRoute(req, res, url)) return;
      } catch (err) {
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Request failed" }));
        return;
      }
    }

    // Export, import and backup downloads. Gated in full: export hands over
    // every setting in the app and import replaces them, so these are strictly
    // more sensitive than the tRPC surface beside them, not less.
    if (path.startsWith("/api/portability/") || path.startsWith("/api/backups/")) {
      if (rejectIfNotAdmin(req, res)) return;
      try {
        if (await handlePortabilityRoute(req, res, url)) return;
      } catch (err) {
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Request failed" }));
        return;
      }
    }

    // Collection poster upload — binary with a progress bar, which the tRPC
    // batch link can't carry. Gated: it writes to the Plex server.
    if (path.startsWith("/api/collections/")) {
      if (rejectIfNotAdmin(req, res)) return;
      try {
        if (await handleCollectionRoute(req, res, url)) return;
      } catch (err) {
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Request failed" }));
        return;
      }
    }

    // The agent API. Not behind `rejectIfNotAdmin`: an AI client has no Plex
    // session cookie to present, so it carries an API key instead, and the
    // module checks that itself — on every request, auth on or off.
    if (isAgentApiPath(path)) {
      await sendFetchResponse(await handleAgentRequest(toFetchRequest(req)), res);
      return;
    }

    // tRPC API routes
    if (path.startsWith("/api/trpc")) {
      const fetchReq = toFetchRequest(req);
      // The context opens a request scope; dispose it once the response is
      // written, whichever way the request ended.
      let scope: { dispose(): Promise<void> } | undefined;
      try {
        const fetchRes = await fetchRequestHandler({
          endpoint: "/api/trpc",
          req: fetchReq,
          router: appRouter,
          createContext: ({ req: r, resHeaders }) => {
            const ctx = createAdminContext({ req: r, resHeaders, ip: clientIp(req) });
            scope = ctx.scope;
            return ctx;
          },
        });
        await sendFetchResponse(fetchRes, res);
      } finally {
        await scope?.dispose();
      }
      return;
    }

    // Static files — `resolveStaticPath` rejects `..`-traversal attempts.
    const resolved = resolveStaticPath(distDir, path);
    if (resolved && (await serveStatic(res, resolved))) return;

    if (isBuildAsset(path)) return sendStaleAsset(res);

    // SPA fallback
    await serveStatic(res, join(distDir, "index.html"));
  };
}

export interface PortalHandlerDeps {
  portalRouter: Trpc["portalRouter"];
  createPortalContext: Trpc["createPortalContext"];
  portalDistDir: string;
  getConfig: Services["config"]["getConfig"];
  /** The Plex thumb behind a signed movie-match poster path, or null. See `@rube/domain.match`. */
  posterThumb: Services["match"]["posterThumb"];
  /** Injectable for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
}

const POSTER_PATH = "/api/match/poster/";

export function createPortalHandler(deps: PortalHandlerDeps) {
  const { portalRouter, createPortalContext, portalDistDir, getConfig, posterThumb, fetchImpl = fetch } = deps;

  return async function handlePortalRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const path = url.pathname;

    if (path.startsWith("/api/trpc")) {
      const fetchReq = toFetchRequest(req);
      const fetchRes = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req: fetchReq,
        router: portalRouter,
        createContext: ({ req: r, resHeaders }) => createPortalContext({ req: r, resHeaders, ip: clientIp(req) }),
      });
      await sendFetchResponse(fetchRes, res);
      return;
    }

    // Movie-match posters. Not session-gated, because guests have no session
    // and an `<img>` in the native app can't send one: the path is signed
    // instead, and only ever handed to someone the room let in. The signature
    // names the rating key and the thumb is looked up from it, so no caller
    // chooses which Plex path is fetched.
    if (path.startsWith(POSTER_PATH) && (req.method === "GET" || req.method === "HEAD")) {
      let ratingKey: string | null;
      try {
        ratingKey = decodeURIComponent(path.slice(POSTER_PATH.length));
      } catch {
        ratingKey = null; // A malformed escape is a miss, not a 500.
      }
      const thumb = ratingKey === null ? null : posterThumb(ratingKey, url.searchParams.get("sig"));
      const imageUrl =
        thumb &&
        buildPlexImageUrl({
          thumbPath: thumb,
          plexUrl: getConfig("global_plex_url"),
          plexToken: getConfig("global_plex_token"),
        });
      if (!imageUrl) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      await proxyPlexImage(res, imageUrl, fetchImpl);
      return;
    }

    // An `/api/...` path this server doesn't implement is a 404, not the SPA.
    // `/api/plex-image` and `/api/prerolls/…` exist only on the admin server, and
    // answering them here with `index.html` and a 200 made a missing endpoint
    // look like a broken image rather than a wrong port.
    if (path.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    const resolved = resolveStaticPath(portalDistDir, path);
    if (resolved && (await serveStatic(res, resolved))) return;

    if (isBuildAsset(path)) return sendStaleAsset(res);

    // Portal SPA fallback — the portal app, never the admin one.
    await serveStatic(res, join(portalDistDir, "index.html"));
  };
}
