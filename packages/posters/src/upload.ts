/**
 * Turning bytes somebody handed us into a poster Plex will accept.
 *
 * Shares the stance of `fetch-url.ts`: the declared type is not evidence, the
 * decoder is. An uploaded file is if anything less trustworthy than a fetched
 * one — it never passed a host allow-list — so it goes through the same decode
 * check before any of it is believed, and the same byte ceiling before it
 * reaches the decoder at all.
 *
 * The output is always the geometry Plex expects. A collection poster that is
 * the wrong shape isn't rejected by Plex, it is letterboxed by every client
 * that shows it, which looks like a bug in Tinkerbell rather than in the file.
 */
import sharp from "sharp";
import { COLLECTION_POSTER_HEIGHT, COLLECTION_POSTER_WIDTH, POSTER_MAX_BYTES } from "@tinkerbell/contracts";

export type PosterUpload = { status: "ok"; buffer: Buffer } | { status: "rejected"; reason: string };

/** Formats worth accepting as poster art. Matches the fetched-URL path. */
const ALLOWED_FORMATS = new Set(["jpeg", "jpg", "png", "webp", "avif", "gif", "heif"]);

/** JPEG quality for the stored poster — the same the templates render at. */
const QUALITY = 88;

export async function normalizePosterUpload(buffer: Buffer): Promise<PosterUpload> {
  if (buffer.length === 0) return { status: "rejected", reason: "The upload was empty." };
  if (buffer.length > POSTER_MAX_BYTES) {
    return { status: "rejected", reason: `Images must be under ${Math.floor(POSTER_MAX_BYTES / 1024 / 1024)} MB.` };
  }

  let format: string | undefined;
  try {
    const metadata = await sharp(buffer).metadata();
    format = metadata.format;
    if (!format || !ALLOWED_FORMATS.has(format)) {
      return { status: "rejected", reason: `That file is not a supported image (${format ?? "unknown format"}).` };
    }
    if (!metadata.width || !metadata.height) {
      return { status: "rejected", reason: "That image has no readable dimensions." };
    }
  } catch {
    return { status: "rejected", reason: "That file did not decode as an image." };
  }

  try {
    const out = await sharp(buffer)
      // `cover` crops rather than distorts. A poster stretched to 2:3 is more
      // obviously wrong than one whose edges are trimmed to it.
      .resize(COLLECTION_POSTER_WIDTH, COLLECTION_POSTER_HEIGHT, { fit: "cover", position: "attention" })
      .jpeg({ quality: QUALITY })
      .toBuffer();
    return { status: "ok", buffer: out };
  } catch (err) {
    return { status: "rejected", reason: err instanceof Error ? err.message : "The image could not be converted." };
  }
}
