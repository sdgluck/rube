import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { getAllConfig, getConfig, setConfig } from "./config.ts";

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

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

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

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const path = url.pathname;

  // API routes
  if (path === "/api/test-plex" && req.method === "POST") {
    try {
      const { plex_url, plex_token } = JSON.parse(await readBody(req));
      if (!plex_url || !plex_token) {
        return json(res, 400, { error: "Plex URL and token are required" });
      }
      const testUrl = new URL("/", plex_url);
      testUrl.searchParams.set("X-Plex-Token", plex_token);
      const pRes = await fetch(testUrl.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!pRes.ok) {
        return json(res, 200, {
          ok: false,
          error: `Plex returned ${pRes.status} ${pRes.statusText}`,
        });
      }
      const data = await pRes.json();
      const name = data?.MediaContainer?.friendlyName || "Unknown";
      return json(res, 200, { ok: true, serverName: name });
    } catch (err) {
      return json(res, 200, { ok: false, error: (err as Error).message });
    }
  }

  if (path === "/api/plex-sections" && req.method === "GET") {
    try {
      const plexUrl = getConfig("plex_url");
      const plexToken = getConfig("plex_token");
      if (!plexUrl || !plexToken) {
        return json(res, 400, { error: "Plex URL and token are not configured" });
      }
      const sectionsUrl = new URL("/library/sections", plexUrl);
      sectionsUrl.searchParams.set("X-Plex-Token", plexToken);
      const pRes = await fetch(sectionsUrl.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!pRes.ok) {
        return json(res, 502, { error: `Plex returned ${pRes.status} ${pRes.statusText}` });
      }
      const data = await pRes.json();
      const directories = data?.MediaContainer?.Directory || [];
      const sections = directories.map((d: { key: string; title: string; type: string }) => ({
        key: d.key,
        title: d.title,
        type: d.type,
      }));
      return json(res, 200, sections);
    } catch (err) {
      return json(res, 500, { error: (err as Error).message });
    }
  }

  if (path === "/api/config") {
    if (req.method === "GET") {
      return json(res, 200, getAllConfig());
    }
    if (req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req));
        for (const [key, value] of Object.entries(body)) {
          setConfig(key, value as string);
        }
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, { error: (err as Error).message });
      }
    }
    return json(res, 405, { error: "Method not allowed" });
  }

  // Static files
  const filePath = join(DIST_DIR, path === "/" ? "index.html" : path);
  if (await serveStatic(res, filePath)) return;

  // SPA fallback
  await serveStatic(res, join(DIST_DIR, "index.html"));
});

server.listen(PORT, () => {
  console.log(`Tinkerbell admin server listening on http://localhost:${PORT}`);
});
