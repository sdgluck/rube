import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const VERSION_TIMEOUT_MS = 10_000;

/**
 * Cached because the answer can't change without restarting the process, and
 * both the health check (every minute) and the Prerolls page ask for it.
 * `undefined` means "not looked up yet"; `null` means "looked up, absent".
 */
let cached: string | null | undefined;

/** First line of `ffmpeg -version` is `ffmpeg version 7.1 Copyright …`. */
function parseVersion(stdout: string): string {
  const first = stdout.split("\n")[0] ?? "";
  const match = first.match(/^ffmpeg version (\S+)/);
  return match?.[1] ?? first.trim();
}

/** Resolve the installed ffmpeg version, or null when ffmpeg isn't on PATH. */
export async function ffmpegVersion(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const { stdout } = await execFileAsync("ffmpeg", ["-version"], { timeout: VERSION_TIMEOUT_MS });
    cached = parseVersion(stdout);
  } catch {
    // ENOENT (not installed) and every other failure mode are the same thing
    // to a caller: we can't transcode.
    cached = null;
  }
  return cached;
}

/** Drop the cache — used by tests and by the Settings page's re-check action. */
export function resetFfmpegVersionCache(): void {
  cached = undefined;
}
