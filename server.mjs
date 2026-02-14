import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { getAllConfig, setConfig } from "./config.mjs";

const PORT = parseInt(process.env.PORT || "3000", 10);
const DIST_DIR = join(import.meta.dirname, "web", "dist");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function serveStatic(res, filePath) {
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // API routes
  if (path === "/api/config") {
    if (req.method === "GET") {
      return json(res, 200, getAllConfig());
    }
    if (req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req));
        for (const [key, value] of Object.entries(body)) {
          setConfig(key, value);
        }
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, 400, { error: err.message });
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
