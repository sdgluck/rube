/** The subset of `ffprobe -show_format -show_streams` output we care about. */
export type ProbeResult = {
  /** Container as ffprobe reports it, normalised to the first alias (`mp4`, `matroska`, …). */
  container: string;
  durationMs: number;
  sizeBytes: number;
  bitrate: number;
  video: VideoStream | null;
  audio: AudioStream | null;
};

export type VideoStream = {
  codec: string;
  /** e.g. "High", "Main", "Baseline". Empty when ffprobe doesn't report one. */
  profile: string;
  pixelFormat: string;
  width: number;
  height: number;
  fps: number;
};

export type AudioStream = {
  codec: string;
  channels: number;
  sampleRate: number;
};

/**
 * What the processing job should do with a source file.
 *
 * - `copy`   — already direct-plays; keep the bytes exactly as they are.
 * - `remux`  — right codecs, wrong container (or no faststart); stream-copy
 *              into an mp4. Cheap, lossless.
 * - `encode` — full re-encode to the canonical profile.
 */
export type TranscodeAction = "copy" | "remux" | "encode";

export type Decision = {
  action: TranscodeAction;
  /** Human-readable justifications, surfaced verbatim in the UI. */
  reasons: string[];
};

export type PolicyOptions = {
  /** Downscale anything taller than this. */
  maxHeight: number;
};

export type ProgressCallback = (fraction: number) => void;

export type RunOptions = {
  signal?: AbortSignal;
  /** Total duration of the input, used to turn ffmpeg's `out_time_us` into a fraction. */
  durationMs?: number;
  onProgress?: ProgressCallback;
};
