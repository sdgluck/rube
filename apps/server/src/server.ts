import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, portalRouter, createPortalContext, createAdminContext } from "@tinkerbell/trpc";
import { initJobs, stopSidequest } from "@tinkerbell/jobs";
import {
  adminAuthRequired,
  authDisabledByEnv,
  createLogger,
  errorMessage,
  getConfig,
  getPersonalizedSharingStatus,
  setEventEmitter,
  setHealthReporter,
  setLocalCollectionsReader,
  setPostCollectionSyncHook,
  startAuthDisabledWarning,
} from "@tinkerbell/core";
import { ensureBuiltInPresets } from "@tinkerbell/domain.overlays";
import { reportHealth } from "@tinkerbell/domain.health";
import { scanAllProviders } from "@tinkerbell/domain.migration";
import { getLocalCollections } from "@tinkerbell/domain.collections";
import { emitEvent } from "@tinkerbell/domain.events";
import { buildPlexImageUrl, resolveStaticPath } from "./security.ts";
import { clientIp, rejectIfNotAdmin } from "./auth.ts";
import { handlePrerollRoute } from "./prerolls.ts";

const log = createLogger("server");
const portalLog = createLogger("portal");

setHealthReporter(reportHealth);
// `domains/collections` calls this at the end of `syncCollections`.
// Wired here at boot so the collections domain doesn't have to import
// the migration domain (avoiding the near-cycle the audit flagged).
setPostCollectionSyncHook(scanAllProviders);
// `domains/users` calls this when counting per-user collection labels.
// Registered here so users doesn't import collections directly (GET-118).
setLocalCollectionsReader(() => getLocalCollections());
// `domains/notifications` calls this to record its own send failures
// in the activity feed without importing events directly (which would
// form a cycle; events already imports notifications) — GET-125.
setEventEmitter(emitEvent);

const PORT = parseInt(process.env.PORT || "3000", 10);
// Bind to loopback by default. Tinkerbell has no auth: anyone who can reach
// the port can call every tRPC mutation. The Docker image sets HOST=0.0.0.0
// because the container must be reachable from outside, and trusts the user
// to put it behind a reverse proxy / firewall.
const HOST = process.env.HOST || "127.0.0.1";
// The user portal (Sign-in-with-Plex). Served on its own port so it can be
// exposed publicly without exposing the unauthenticated admin API. Defaults to
// loopback like the admin server; the Docker image opens this one to the host.
const USER_PORT = parseInt(process.env.USER_PORT || "3100", 10);
const USER_HOST = process.env.USER_HOST || HOST;
// The address to print at boot. `api.tinkerbell.localhost` is the localias
// proxy from `pnpm dev` and resolves nowhere else, so it is dev-only — in a
// container it sent people to a hostname their browser can't resolve. A
// wildcard bind isn't a dialable host either, so report loopback for those.
function listenUrl(): string {
  if (process.env.NODE_ENV !== "production") return "https://api.tinkerbell.localhost";
  const host = HOST === "0.0.0.0" || HOST === "::" ? "localhost" : HOST;
  return `http://${host.includes(":") ? `[${host}]` : host}:${PORT}`;
}

const DIST_DIR = join(import.meta.dirname, "..", "..", "web", "dist");
const PORTAL_DIST_DIR = join(import.meta.dirname, "..", "..", "portal", "dist");

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

async function serveStatic(res: ServerResponse, filePath: string): Promise<boolean> {
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

function toFetchRequest(req: IncomingMessage): Request {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  return new Request(url.toString(), {
    method: req.method,
    headers: Object.entries(req.headers).reduce(
      (h, [k, v]) => {
        if (v) h[k] = Array.isArray(v) ? v.join(", ") : v;
        return h;
      },
      {} as Record<string, string>,
    ),
    body: req.method !== "GET" && req.method !== "HEAD" ? (req as unknown as ReadableStream) : undefined,
    // @ts-expect-error duplex is required for streaming request bodies
    duplex: "half",
  });
}

async function sendFetchResponse(fetchRes: Response, res: ServerResponse): Promise<void> {
  res.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers.entries()));
  if (!fetchRes.body) {
    res.end();
    return;
  }
  // `pipeline` honours Node's HTTP backpressure (the previous hand-rolled
  // loop ignored `res.write()`'s return value and buffered without bound)
  // and tears down the upstream reader on error.
  await pipeline(Readable.fromWeb(fetchRes.body as never), res);
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
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
    try {
      const pRes = await fetch(imageUrl.toString(), { signal: AbortSignal.timeout(10000) });
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

  // tRPC API routes
  if (path.startsWith("/api/trpc")) {
    const fetchReq = toFetchRequest(req);
    const fetchRes = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: fetchReq,
      router: appRouter,
      createContext: ({ req: r, resHeaders }) => createAdminContext({ req: r, resHeaders, ip: clientIp(req) }),
    });
    await sendFetchResponse(fetchRes, res);
    return;
  }

  // Static files — `resolveStaticPath` rejects `..`-traversal attempts.
  const resolved = resolveStaticPath(DIST_DIR, path);
  if (resolved && (await serveStatic(res, resolved))) return;

  // SPA fallback
  await serveStatic(res, join(DIST_DIR, "index.html"));
});

// User portal server: only the session-gated portalRouter + the portal SPA.
// The admin appRouter is intentionally NOT mounted here, so even though it's
// unauthenticated it stays unreachable on the public port.
const portalServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path.startsWith("/api/trpc")) {
    const fetchReq = toFetchRequest(req);
    const fetchRes = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: fetchReq,
      router: portalRouter,
      createContext: ({ req: r, resHeaders }) => createPortalContext({ req: r, resHeaders }),
    });
    await sendFetchResponse(fetchRes, res);
    return;
  }

  const resolved = resolveStaticPath(PORTAL_DIST_DIR, path);
  if (resolved && (await serveStatic(res, resolved))) return;

  // Portal SPA fallback — the portal app, never the admin one.
  await serveStatic(res, join(PORTAL_DIST_DIR, "index.html"));
});

// Keep listening even if a bind fails (e.g. port in use) — the reconciler
// retries on its interval rather than crashing the admin server.
portalServer.on("error", (err) => {
  portalLog.error("server error", { err: errorMessage(err) });
});

const PORTAL_RECONCILE_MS = 15_000;

// The portal only runs while personalization is enabled. The status flips
// inside the enable/disable jobs, so we poll and start/stop accordingly.
function syncPortalServer(): void {
  const shouldRun = getPersonalizedSharingStatus() === "enabled";
  if (shouldRun && !portalServer.listening) {
    portalServer.listen(USER_PORT, USER_HOST, () => {
      portalLog.info("listening", { host: USER_HOST, port: USER_PORT });
    });
  } else if (!shouldRun && portalServer.listening) {
    portalServer.close(() => portalLog.info("stopped (personalization disabled)"));
  }
}

async function main() {
  // Finish boot before we accept any traffic. If init fails we want clean
  // "connection refused" rather than half-initialised tRPC handlers, and a
  // crash should happen before the port opens.
  try {
    ensureBuiltInPresets();
  } catch (err) {
    log.error("failed to seed built-in overlay presets", { err: errorMessage(err) });
  }
  try {
    await initJobs();
  } catch (err) {
    log.error("job init failed", { err: errorMessage(err) });
    process.exit(1);
  }
  startAuthDisabledWarning();
  server.listen(PORT, HOST, () => {
    log.info("admin server listening", { host: HOST, port: PORT, url: listenUrl() });
    const loopback = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";
    if (adminAuthRequired()) {
      log.info("admin authentication is active — sign in with the Plex server owner's account");
    } else if (!loopback) {
      // The combination that stays genuinely dangerous, and keeps saying so:
      // reachable from the network with nothing checking who's calling.
      log.warn(
        `Listening on ${HOST}: every tRPC mutation is reachable without authentication` +
          (authDisabledByEnv() ? " (TINKERBELL_DISABLE_AUTH is set)" : "") +
          `. Only expose this port to networks you trust, or enable admin authentication in the app.`,
      );
    }
  });
  // Start the portal only if personalization is already enabled, and keep it
  // in sync with the master switch thereafter.
  syncPortalServer();
  setInterval(syncPortalServer, PORTAL_RECONCILE_MS).unref();
}

main().catch((err) => {
  log.error("unhandled error during startup", { err: errorMessage(err) });
  process.exit(1);
});

const SHUTDOWN_GRACE_MS = 10_000;

let shuttingDown = false;
async function shutdown() {
  // Two signals = exit now. Container orchestrators send SIGTERM, wait,
  // then SIGKILL, and a human pressing Ctrl-C twice means "I'm impatient".
  if (shuttingDown) process.exit(0);
  shuttingDown = true;

  await stopSidequest();

  // Stop accepting new connections, then wait up to SHUTDOWN_GRACE_MS for
  // in-flight requests (streaming Plex images, large tRPC responses) to
  // drain. Force-close anything still hanging so we don't block the
  // container exit forever.
  const closed = Promise.all([
    new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => portalServer.close(() => resolve())),
  ]);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref());
  await Promise.race([closed, timeout]);
  server.closeAllConnections();
  portalServer.closeAllConnections();

  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// On modern Node an unhandled rejection terminates the process with no
// context. There are fire-and-forget call sites (preroll processing, the BYW
// uninstall cleanup) where a future edit could easily introduce one, and
// "container died, no log line" is the worst possible failure mode on a home
// server.
process.on("unhandledRejection", (reason) => {
  log.error("unhandled promise rejection", { err: errorMessage(reason) });
});

// Exiting here is deliberate: the process is in an unknown state, and the
// Docker restart policy is a better recovery mechanism than carrying on.
process.on("uncaughtException", (err) => {
  log.error("uncaught exception — exiting for restart", { err: errorMessage(err) });
  process.exit(1);
});
