/**
 * Getting bytes onto disk — shared by the HTTP upload route and the
 * import-from-URL mutation so both enforce the same limits.
 */

import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assertSafeOutboundUrl, httpRequest } from "@rube/http";
import { extensionOf, incomingPath } from "./index.ts";

/**
 * Containers we'll accept an upload in. Everything here is something ffmpeg
 * can read; the transcoder decides what to do with it afterwards.
 */
export const ALLOWED_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".ts",
  ".mpg",
  ".mpeg",
  ".wmv",
]);

/**
 * Prerolls are seconds long. Two gigabytes is well past any legitimate one
 * and keeps a runaway or hostile upload from filling the volume.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

export class UploadTooLargeError extends Error {
  constructor() {
    super(`File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`);
    this.name = "UploadTooLargeError";
  }
}

export class UnsupportedFormatError extends Error {
  extension: string;

  constructor(extension: string) {
    super(`${extension || "That file type"} isn't a supported video container`);
    this.name = "UnsupportedFormatError";
    this.extension = extension;
  }
}

export function assertSupportedFilename(filename: string): string {
  const ext = extensionOf(filename);
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new UnsupportedFormatError(ext);
  return ext;
}

/**
 * Stream `source` into the incoming directory, aborting past the size cap.
 *
 * The cap is enforced as bytes arrive rather than from a Content-Length
 * header, because a chunked upload doesn't send one and a lying one is
 * trivial to send.
 */
export async function writeIncoming(id: string, ext: string, source: Readable): Promise<number> {
  const target = incomingPath(id, ext);
  let bytes = 0;

  // A Transform rather than a `data` listener so `pipeline` keeps honouring
  // backpressure from the file write — a raw listener would buffer the whole
  // upload in memory on a slow disk.
  const limit = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD_BYTES) {
        done(new UploadTooLargeError());
        return;
      }
      done(null, chunk);
    },
  });

  try {
    await pipeline(source, limit, createWriteStream(target));
  } catch (err) {
    // Never leave a truncated file behind: the processing job would probe it
    // and report a confusing codec error instead of "the upload failed".
    await rm(target, { force: true });
    throw err;
  }
  return bytes;
}

/**
 * Fetch a remote video into the incoming directory.
 *
 * Goes through the SSRF guard because the URL comes from the browser and the
 * admin API is unauthenticated — without it, this would be a request forgery
 * primitive pointed at whatever else is on the user's network.
 */
export async function downloadIncoming(id: string, url: string, ext: string): Promise<number> {
  assertSafeOutboundUrl(url);
  const res = await httpRequest({ url, timeoutMs: 120_000, retries: 1 });
  if (!res.body) throw new Error("The server returned an empty response");
  return writeIncoming(id, ext, Readable.fromWeb(res.body as never));
}

/** Derive a filename from a URL so the extension check has something to work on. */
export function filenameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "";
  } catch {
    return "";
  }
}
