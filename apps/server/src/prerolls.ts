/**
 * The three preroll routes that can't be tRPC procedures.
 *
 * Uploads are hundreds of megabytes and want a real progress bar; playback
 * wants byte ranges. Both are streaming concerns that `httpBatchLink` can't
 * express, so they live here alongside the existing `/api/plex-image` proxy.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { errorMessage } from "@tinkerbell/core";
import { startJob } from "@tinkerbell/jobs";
import {
  UnsupportedFormatError,
  UploadTooLargeError,
  assertSupportedFilename,
  createPreroll,
  deletePreroll,
  ensurePrerollDirs,
  processedPath,
  thumbPath,
  writeIncoming,
} from "@tinkerbell/domain.prerolls";
import { resolvePrerollId } from "./security.ts";

const UPLOAD_PATH = "/api/prerolls/upload";
const PREROLL_ROUTE_RE = /^\/api\/prerolls\/([^/]+)\/(preview|thumb)$/;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

/**
 * Serve a file with `Range` support.
 *
 * The `<video>` element issues a range request on every seek; without this it
 * would refetch the whole clip each time, and Safari refuses to play a source
 * that doesn't advertise range support at all.
 */
async function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  contentType: string,
): Promise<void> {
  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    json(res, 404, { error: "Not found" });
    return;
  }

  const common = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    // Content is immutable per id — a preroll's file never changes in place,
    // it's replaced by a new row — so this is safe to cache hard.
    "Cache-Control": "private, max-age=3600",
  };

  const range = req.headers.range;
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match) {
    const startRaw = match[1];
    const endRaw = match[2];
    // `bytes=-500` means the last 500 bytes, not "from 0 to 500".
    const start = startRaw ? Number(startRaw) : Math.max(0, size - Number(endRaw || 0));
    const end = startRaw ? (endRaw ? Math.min(Number(endRaw), size - 1) : size - 1) : size - 1;

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      ...common,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
    });
    await pipeline(createReadStream(filePath, { start, end }), res);
    return;
  }

  res.writeHead(200, { ...common, "Content-Length": size });
  await pipeline(createReadStream(filePath), res);
}

/**
 * `POST /api/prerolls/upload?filename=…&name=…`
 *
 * The body is the raw file — no multipart. The browser sends a `File`
 * directly, which keeps this a plain stream-to-disk with no parser in the
 * middle, and lets `XMLHttpRequest` report upload progress.
 */
async function handleUpload(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== "POST") {
    json(res, 405, { error: "Use POST" });
    return;
  }

  const originalFilename = (url.searchParams.get("filename") ?? "").trim();
  if (!originalFilename) {
    json(res, 400, { error: "A filename query parameter is required" });
    return;
  }

  let ext: string;
  try {
    ext = assertSupportedFilename(originalFilename);
  } catch (err) {
    if (err instanceof UnsupportedFormatError) {
      json(res, 415, { error: err.message });
      return;
    }
    throw err;
  }

  await ensurePrerollDirs();

  // The row exists before the bytes do, so a half-finished upload is visible
  // in the UI as a failed preroll rather than vanishing without trace.
  const row = createPreroll({ name: url.searchParams.get("name") ?? originalFilename, originalFilename });

  try {
    const bytes = await writeIncoming(row.id, ext, req);
    if (bytes === 0) throw new Error("The upload was empty");
  } catch (err) {
    await deletePreroll(row.id);
    if (err instanceof UploadTooLargeError) {
      json(res, 413, { error: err.message });
      return;
    }
    json(res, 400, { error: `Upload failed: ${errorMessage(err)}` });
    return;
  }

  // Fire-and-forget: the client polls `prerolls.list` for status, and a job
  // that's already running will pick this row up on its own.
  startJob("preroll-process").catch(() => {});

  json(res, 200, { id: row.id });
}

/**
 * Route a request if it belongs to the prerolls API. Returns false when it
 * doesn't, so the caller can fall through to the rest of the server.
 */
export async function handlePrerollRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;

  if (path === UPLOAD_PATH) {
    await handleUpload(req, res, url);
    return true;
  }

  const match = path.match(PREROLL_ROUTE_RE);
  if (!match) return false;

  const id = resolvePrerollId(match[1]);
  if (!id) {
    json(res, 400, { error: "Invalid preroll id" });
    return true;
  }

  if (match[2] === "thumb") {
    await serveFile(req, res, thumbPath(id), "image/jpeg");
  } else {
    await serveFile(req, res, processedPath(id), "video/mp4");
  }
  return true;
}
