/**
 * ffmpeg/ffprobe wrapper.
 *
 * A deliberate leaf package — it depends on nothing else in the workspace, so
 * both `jobs` and the tRPC layer can use it without a cycle. Mirrors how
 * `@tinkerbell/http` and `@tinkerbell/posters` are structured.
 *
 * Usage:
 *   const info = await probe(path);
 *   const { action, reasons } = decide(info, { maxHeight: 1080 });
 *   await applyAction(action, path, outPath, { maxHeight: 1080, durationMs: info.durationMs });
 */

export { probe, parseProbeOutput, ProbeError } from "./probe.ts";
export { decide } from "./policy.ts";
export {
  applyAction,
  runFfmpeg,
  encodeArgs,
  encodeStill,
  remuxArgs,
  stillArgs,
  FfmpegError,
  MAX_FPS,
} from "./transcode.ts";
export type { EncodeOptions, ProcessOptions, StillOptions } from "./transcode.ts";
export { generateThumbnail } from "./thumbnail.ts";
export type { ThumbnailOptions } from "./thumbnail.ts";
export { ffmpegVersion, resetFfmpegVersionCache } from "./available.ts";
export type {
  AudioStream,
  Decision,
  PolicyOptions,
  ProbeResult,
  ProgressCallback,
  RunOptions,
  TranscodeAction,
  VideoStream,
} from "./types.ts";
