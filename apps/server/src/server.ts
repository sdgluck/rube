import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
  if (fetchRes.body) {
    const reader = fetchRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
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
      res.writeHead(200, {
        "Content-Type": pRes.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      });
      const reader = pRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch {
      res.writeHead(502);
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
  server.listen(PORT, () => {
    console.log(`Tinkerbell admin server listening on port ${PORT} (https://api.tinkerbell.localhost)`);
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
