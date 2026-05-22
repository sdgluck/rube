import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@tinkerbell/trpc";
import { initJobs, stopSidequest } from "@tinkerbell/jobs";
import { getConfig, setHealthReporter, setPostCollectionSyncHook } from "@tinkerbell/core";
import { ensureBuiltInPresets } from "@tinkerbell/domain.overlays";
import { reportHealth } from "@tinkerbell/domain.health";
import { scanAllProviders } from "@tinkerbell/domain.migration";
import { buildPlexImageUrl, resolveStaticPath } from "./security.ts";

setHealthReporter(reportHealth);
// `domains/collections` calls this at the end of `syncCollections`.
// Wired here at boot so the collections domain doesn't have to import
// the migration domain (avoiding the near-cycle the audit flagged).
setPostCollectionSyncHook(scanAllProviders);

const PORT = parseInt(process.env.PORT || "3000", 10);
// Bind to loopback by default. Tinkerbell has no auth: anyone who can reach
// the port can call every tRPC mutation. The Docker image sets HOST=0.0.0.0
// because the container must be reachable from outside, and trusts the user
// to put it behind a reverse proxy / firewall.
const HOST = process.env.HOST || "127.0.0.1";
const DIST_DIR = join(import.meta.dirname, "..", "..", "web", "dist");

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

  // Plex image proxy
  if (path === "/api/plex-image") {
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

  // tRPC API routes
  if (path.startsWith("/api/trpc")) {
    const fetchReq = toFetchRequest(req);
    const fetchRes = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: fetchReq,
      router: appRouter,
      createContext: () => ({}),
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

async function main() {
  // Finish boot before we accept any traffic. If init fails we want clean
  // "connection refused" rather than half-initialised tRPC handlers, and a
  // crash should happen before the port opens.
  try {
    ensureBuiltInPresets();
  } catch (err) {
    console.error("[overlays] failed to seed built-in presets:", err);
  }
  try {
    await initJobs();
  } catch (err) {
    console.error("[jobs] Init failed:", err);
    process.exit(1);
  }
  server.listen(PORT, HOST, () => {
    console.log(`Tinkerbell admin server listening on ${HOST}:${PORT} (https://api.tinkerbell.localhost)`);
    if (HOST !== "127.0.0.1" && HOST !== "localhost" && HOST !== "::1") {
      console.warn(
        `[security] Listening on ${HOST}: every tRPC mutation is reachable without authentication. ` +
          `Only expose this port to networks you trust.`,
      );
    }
  });
}

main().catch((err) => {
  console.error("[boot] Unhandled error during startup:", err);
  process.exit(1);
});

async function shutdown() {
  await stopSidequest();
  server.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
