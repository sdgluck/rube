/**
 * Fetching a poster from a URL a rule config names.
 *
 * That URL is untrusted input — a registry pack is third-party content, and
 * this is a server-side fetch on a schedule whose result is handed to a native
 * image decoder. So: HTTPS only, an allow-listed host, a byte ceiling enforced
 * while streaming rather than after, and a decode check before anything
 * downstream treats the bytes as an image.
 */
import sharp from "sharp";
import { POSTER_MAX_BYTES, posterUrlError } from "@rube/contracts";

export type PosterUrlFetch =
  | { status: "ok"; buffer: Buffer; contentType: string }
  | { status: "rejected"; reason: string };

const FETCH_TIMEOUT_MS = 20_000;

/** Formats sharp can decode that are worth accepting as poster art. */
const ALLOWED_FORMATS = new Set(["jpeg", "jpg", "png", "webp", "avif", "gif", "heif"]);

export async function fetchPosterUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<PosterUrlFetch> {
  const rejection = posterUrlError(url);
  if (rejection) return { status: "rejected", reason: rejection };

  let res: Response;
  try {
    // `redirect: "error"` deliberately: a 302 off the allow-list would defeat
    // the host check entirely, and every host on that list serves its images
    // directly.
    res = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    return { status: "rejected", reason: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) return { status: "rejected", reason: `${res.status} ${res.statusText}` };

  // Trust the declared length only to reject early — a lying or absent header
  // is caught by the streaming cap below.
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > POSTER_MAX_BYTES) {
    return { status: "rejected", reason: `image is ${declared} bytes, over the ${POSTER_MAX_BYTES}-byte cap` };
  }

  const buffer = await readCapped(res, POSTER_MAX_BYTES);
  if (!buffer) return { status: "rejected", reason: `image exceeds the ${POSTER_MAX_BYTES}-byte cap` };

  // The upstream MIME is not evidence. Ask the decoder what it actually is,
  // before any layout code assumes it has an image.
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      return { status: "rejected", reason: `response is not a supported image (${metadata.format ?? "unknown"})` };
    }
    if (!metadata.width || !metadata.height) {
      return { status: "rejected", reason: "response has no image dimensions" };
    }
    return { status: "ok", buffer, contentType: `image/${metadata.format}` };
  } catch (err) {
    return { status: "rejected", reason: `response did not decode as an image: ${errText(err)}` };
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read a response body, giving up the moment it passes `limit` bytes. */
async function readCapped(res: Response, limit: number): Promise<Buffer | null> {
  if (!res.body) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
