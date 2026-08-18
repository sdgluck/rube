/**
 * The one collection route that can't be a tRPC procedure.
 *
 * A poster upload is a few megabytes of binary with a progress bar attached,
 * and `httpBatchLink` carries JSON. So the body is the raw file — no multipart
 * envelope, matching `/api/prerolls/upload` — and the browser sends a `File`
 * straight through `XMLHttpRequest`.
 *
 * Everything the bytes have to survive lives in `normalizePosterUpload`: the
 * size cap before the decoder sees anything, the decode check before anything
 * else believes it is an image, and the resize to Plex's poster geometry.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { errorMessage } from "@tinkerbell/core";
import type { Services } from "@tinkerbell/composition";
import { POSTER_MAX_BYTES } from "@tinkerbell/contracts";
import { normalizePosterUpload } from "@tinkerbell/posters";

const POSTER_ROUTE_RE = /^\/api\/collections\/([^/]+)\/poster$/;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

/**
 * Buffer the request body, giving up the moment it passes the cap.
 *
 * Enforced while reading rather than after: the point of a ceiling is that the
 * process never holds more than it, which a length check on a finished buffer
 * doesn't provide.
 */
async function readCapped(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > limit) {
      req.destroy();
      return null;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Route a request if it belongs to the collections API. Returns false when it
 * doesn't, so the caller can fall through to the rest of the server.
 */
export function createCollectionRoutes(deps: Services) {
  async function handlePosterUpload(req: IncomingMessage, res: ServerResponse, ratingKey: string): Promise<void> {
    if (req.method !== "POST") {
      json(res, 405, { error: "Use POST" });
      return;
    }

    // The rating key is checked against the local mirror rather than passed
    // through: this endpoint uploads to whatever key it is given, and the mirror
    // is what says the key is a collection this server actually has.
    const row = getLocalCollection(ratingKey);
    if (!row) {
      json(res, 404, { error: "Collection not found" });
      return;
    }

    const raw = await readCapped(req, POSTER_MAX_BYTES);
    if (!raw) {
      json(res, 413, { error: `Images must be under ${Math.floor(POSTER_MAX_BYTES / 1024 / 1024)} MB.` });
      return;
    }

    const normalized = await normalizePosterUpload(raw);
    if (normalized.status === "rejected") {
      json(res, 400, { error: normalized.reason });
      return;
    }

    try {
      const client = getPlexClient();
      await client.uploadPoster(ratingKey, normalized.buffer);
    } catch (err) {
      json(res, 502, { error: `Plex refused the poster: ${errorMessage(err)}` });
      return;
    }

    // The lock and the local re-mirror are the caller's next step, through
    // `collections.syncOne` — they need the session the tRPC gate already
    // established, and doing them here would duplicate that path.
    json(res, 200, { ok: true });
  }

  const { getPlexClient } = deps.clients;
  const { getLocalCollection } = deps.collections;

  async function handleCollectionRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const match = url.pathname.match(POSTER_ROUTE_RE);
    if (!match) return false;
    await handlePosterUpload(req, res, decodeURIComponent(match[1]));
    return true;
  }

  return { handleCollectionRoute };
}
