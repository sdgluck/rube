import { rename, rm } from "node:fs/promises";
import { runFfmpeg } from "./transcode.ts";

/** Grab the frame 10% in — far enough past a fade-from-black to be legible. */
const SEEK_FRACTION = 0.1;
const THUMB_WIDTH = 480;

export type ThumbnailOptions = {
  durationMs: number;
  signal?: AbortSignal;
};

/**
 * Write a single JPEG poster frame for `input` to `output`.
 *
 * `-ss` before `-i` seeks by keyframe, which is near-instant even on a long
 * source. Written to a temp file and renamed so a failed grab never leaves a
 * zero-byte thumbnail behind.
 */
export async function generateThumbnail(input: string, output: string, opts: ThumbnailOptions): Promise<void> {
  const seekSeconds = Math.max(0, (opts.durationMs * SEEK_FRACTION) / 1000);
  const tmp = `${output}.tmp.jpg`;
  try {
    await runFfmpeg(
      [
        "-ss",
        seekSeconds.toFixed(3),
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        `scale=${THUMB_WIDTH}:-2`,
        "-q:v",
        "4",
        "-y",
        tmp,
      ],
      { signal: opts.signal },
    );
    await rename(tmp, output);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
