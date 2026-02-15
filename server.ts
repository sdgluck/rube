import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./trpc.ts";
import { initJobs } from "./jobs.ts";

const PORT = parseInt(process.env.PORT || "3000", 10);
const DIST_DIR = join(import.meta.dirname, "web", "dist");

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

  // Static files
  const filePath = join(DIST_DIR, path === "/" ? "index.html" : path);
  if (await serveStatic(res, filePath)) return;

  // SPA fallback
  await serveStatic(res, join(DIST_DIR, "index.html"));
});

server.listen(PORT, () => {
  console.log(`Tinkerbell admin server listening on http://localhost:${PORT}`);
  initJobs();
});
