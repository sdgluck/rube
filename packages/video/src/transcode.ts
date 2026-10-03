import { spawn } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import type { PolicyOptions, ProgressCallback, RunOptions, TranscodeAction } from "./types.ts";

/** Tail of ffmpeg's stderr kept for the error message when it exits non-zero. */
const STDERR_KEEP_CHARS = 4000;

export class FfmpegError extends Error {
  // Declared and assigned separately rather than as a constructor parameter
  // property: Node runs this workspace's TypeScript by stripping types, which
  // can't synthesise the implicit assignment.
  stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.name = "FfmpegError";
    this.stderr = stderr;
  }
}

/**
 * Spawn ffmpeg and resolve when it exits 0.
 *
 * `-progress pipe:1` makes ffmpeg emit `key=value` lines on stdout; we watch
 * `out_time_us` to drive a real percentage instead of a spinner. Aborting the
 * signal kills the child, which is what makes job cancellation actually stop
 * an encode rather than just orphaning it.
 */
export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<void> {
  const { signal, durationMs, onProgress } = opts;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Cancelled"));
      return;
    }

    const child = spawn(
      "ffmpeg",
      ["-nostdin", "-hide_banner", "-loglevel", "error", ...args, "-progress", "pipe:1", "-nostats"],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    let stdoutBuf = "";
    let settled = false;

    const onAbort = () => {
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    function finish(err: Error | null): void {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (!onProgress || !durationMs) return;
      stdoutBuf += chunk;
      // Keep only the trailing partial line; progress blocks are small and
      // frequent, so there's no point buffering more than that.
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        const [key, value] = line.split("=");
        if (key !== "out_time_us") continue;
        const us = Number(value);
        if (!Number.isFinite(us) || us < 0) continue;
        onProgress(Math.min(us / 1000 / durationMs, 1));
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_KEEP_CHARS);
    });

    child.on("error", (err) => {
      // ENOENT here means ffmpeg isn't installed; callers check availability
      // up front, so this is the belt-and-braces path.
      finish(err);
    });

    child.on("close", (code) => {
      if (signal?.aborted) {
        finish(new Error("Cancelled"));
        return;
      }
      if (code === 0) {
        onProgress?.(1);
        finish(null);
        return;
      }
      finish(new FfmpegError(`ffmpeg exited with code ${code}`, stderr.trim()));
    });
  });
}

/** Stream-copy the existing video and audio into a faststart MP4. */
export function remuxArgs(input: string, output: string): string[] {
  return ["-y", "-i", input, "-c", "copy", "-movflags", "+faststart", output];
}

/** Ceiling matching the one `policy.ts` checks against. */
export const MAX_FPS = 60;

export type EncodeOptions = PolicyOptions & {
  /** Source frame rate, so we only cap fps rather than resampling every clip. */
  sourceFps?: number;
};

/**
 * The canonical encode profile: H.264 High @ 8-bit 4:2:0, stereo AAC, in a
 * faststart MP4.
 *
 * `scale=-2:'min(ih,H)'` caps the height without ever upscaling, and `-2`
 * derives a width that both preserves the aspect ratio and stays even —
 * which libx264 requires under yuv420p.
 */
export function encodeArgs(input: string, output: string, opts: EncodeOptions): string[] {
  const args = [
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
    // Not every source has audio. `?` makes the audio map optional instead of
    // failing the whole encode.
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-vf",
    `scale=-2:'min(ih,${opts.maxHeight})'`,
  ];

  // Only resample when the source is genuinely too fast — forcing -r on a
  // 24 fps clip would duplicate frames for no benefit.
  if (opts.sourceFps && opts.sourceFps > MAX_FPS) {
    args.push("-r", String(MAX_FPS));
  }

  args.push("-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", output);
  return args;
}

export type ProcessOptions = EncodeOptions & {
  signal?: AbortSignal;
  durationMs?: number;
  onProgress?: ProgressCallback;
};

/**
 * Apply a decision, writing to `output` atomically: ffmpeg renders into a
 * sibling temp file that is renamed into place only on success, so a killed
 * encode can never leave a truncated file that later looks "ready".
 */
export async function applyAction(
  action: TranscodeAction,
  input: string,
  output: string,
  opts: ProcessOptions,
): Promise<void> {
  if (action === "copy") {
    await rename(input, output);
    opts.onProgress?.(1);
    return;
  }

  const tmp = `${output}.tmp.mp4`;
  const args = action === "remux" ? remuxArgs(input, tmp) : encodeArgs(input, tmp, opts);
  try {
    await runFfmpeg(args, { signal: opts.signal, durationMs: opts.durationMs, onProgress: opts.onProgress });
    await rename(tmp, output);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export type StillOptions = {
  durationMs: number;
  maxHeight: number;
};

/** Frame rate for a held still. Nothing moves, so the lowest common rate. */
const STILL_FPS = 24;
const STILL_FADE_S = 0.5;

/**
 * Hold one image for `durationMs`, as the same H.264/AAC MP4 profile
 * `encodeArgs` produces, so a generated preroll direct plays wherever an
 * uploaded one does.
 *
 * The silent stereo track is deliberate: a video-only preroll in front of a
 * film with audio makes some Plex clients rebuild their audio pipeline at the
 * cut, which is an audible pop or a second of dead air. A short fade in and
 * out keeps the card from slamming onto and off the screen.
 */
export function stillArgs(input: string, output: string, opts: StillOptions): string[] {
  const seconds = Math.max(1, opts.durationMs / 1000);
  const fadeOutAt = Math.max(0, seconds - STILL_FADE_S);
  return [
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(STILL_FPS),
    "-i",
    input,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-t",
    seconds.toFixed(3),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-vf",
    `scale=-2:'min(ih,${opts.maxHeight})',fade=t=in:st=0:d=${STILL_FADE_S},fade=t=out:st=${fadeOutAt.toFixed(3)}:d=${STILL_FADE_S},format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-tune",
    "stillimage",
    "-crf",
    "20",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-r",
    String(STILL_FPS),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    output,
  ];
}

/** {@link stillArgs}, written atomically like {@link applyAction}. */
export async function encodeStill(
  input: string,
  output: string,
  opts: StillOptions & { signal?: AbortSignal; onProgress?: ProgressCallback },
): Promise<void> {
  const tmp = `${output}.tmp.mp4`;
  try {
    await runFfmpeg(stillArgs(input, tmp, opts), {
      signal: opts.signal,
      durationMs: opts.durationMs,
      onProgress: opts.onProgress,
    });
    await rename(tmp, output);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
