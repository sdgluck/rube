import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AudioStream, ProbeResult, VideoStream } from "./types.ts";

const execFileAsync = promisify(execFile);

/** ffprobe emits huge stream lists for some files; 8 MiB is far beyond any of them. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 60_000;

type RawStream = {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  channels?: number;
  sample_rate?: string;
};

type RawProbe = {
  format?: { format_name?: string; duration?: string; size?: string; bit_rate?: string };
  streams?: RawStream[];
};

/**
 * ffprobe reports comma-separated container aliases (`mov,mp4,m4a,3gp,3g2,mj2`).
 * We only ever compare against the first, which is the canonical one.
 */
function normaliseContainer(formatName: string | undefined): string {
  return (formatName ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
}

/** `r_frame_rate` is a rational string like "24000/1001". */
function parseFrameRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split("/");
  const n = Number(num);
  const d = den === undefined ? 1 : Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return n / d;
}

function toNumber(value: string | number | undefined): number {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? (n as number) : 0;
}

/** Pure parser, split out from the process spawn so it can be unit-tested. */
export function parseProbeOutput(json: string): ProbeResult {
  const raw = JSON.parse(json) as RawProbe;
  const streams = raw.streams ?? [];

  const rawVideo = streams.find((s) => s.codec_type === "video");
  const rawAudio = streams.find((s) => s.codec_type === "audio");

  const video: VideoStream | null = rawVideo
    ? {
        codec: (rawVideo.codec_name ?? "").toLowerCase(),
        profile: rawVideo.profile ?? "",
        pixelFormat: (rawVideo.pix_fmt ?? "").toLowerCase(),
        width: toNumber(rawVideo.width),
        height: toNumber(rawVideo.height),
        fps: parseFrameRate(rawVideo.r_frame_rate ?? rawVideo.avg_frame_rate),
      }
    : null;

  const audio: AudioStream | null = rawAudio
    ? {
        codec: (rawAudio.codec_name ?? "").toLowerCase(),
        channels: toNumber(rawAudio.channels),
        sampleRate: toNumber(rawAudio.sample_rate),
      }
    : null;

  return {
    container: normaliseContainer(raw.format?.format_name),
    durationMs: Math.round(toNumber(raw.format?.duration) * 1000),
    sizeBytes: toNumber(raw.format?.size),
    bitrate: toNumber(raw.format?.bit_rate),
    video,
    audio,
  };
}

/** Thrown when ffprobe can't make sense of the file. */
export class ProbeError extends Error {
  stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.name = "ProbeError";
    this.stderr = stderr;
  }
}

export async function probe(filePath: string, signal?: AbortSignal): Promise<ProbeResult> {
  let stdout: string;
  try {
    // `-v error` rather than `-v quiet`: when a file is unreadable, ffprobe's
    // own diagnostic on stderr ("moov atom not found", "Invalid data…") is the
    // only useful thing we can show the user.
    ({ stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { signal, maxBuffer: MAX_OUTPUT_BYTES, timeout: PROBE_TIMEOUT_MS },
    ));
  } catch (err) {
    // Node's default message embeds the whole command line, and ffprobe
    // prefixes its own diagnostic with the file path — both of which are
    // internal temp paths the user never chose. Keep only the reason.
    const stderr =
      typeof (err as { stderr?: string }).stderr === "string" ? (err as { stderr: string }).stderr.trim() : "";
    const lastLine = stderr.split("\n").at(-1)?.trim() ?? "";
    const reason = lastLine.startsWith(`${filePath}: `) ? lastLine.slice(filePath.length + 2) : lastLine;
    throw new ProbeError(reason ? `Not a readable video file — ${reason}` : "Not a readable video file", stderr);
  }
  return parseProbeOutput(stdout);
}
