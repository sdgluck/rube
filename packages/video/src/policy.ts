/**
 * The direct-play decision.
 *
 * A preroll that Plex has to transcode defeats the point of the feature: a
 * ten-second clip can occupy a transcode session and stutter on the client.
 * So we normalise anything that isn't already safe — but only that, because
 * re-encoding an already-fine file costs time and a generation of quality.
 *
 * "Safe" here means the intersection of what essentially every Plex client
 * direct-plays: H.264 in an mp4, 8-bit 4:2:0, stereo-or-less AAC.
 */

import type { Decision, PolicyOptions, ProbeResult } from "./types.ts";

/** Containers Plex serves without remuxing. ffprobe calls mp4/mov `mov`. */
const DIRECT_PLAY_CONTAINERS = new Set(["mov", "mp4"]);
const DIRECT_PLAY_VIDEO_CODECS = new Set(["h264"]);
/** Profiles above High (High 10, High 4:2:2, …) imply >8-bit or non-4:2:0. */
const DIRECT_PLAY_VIDEO_PROFILES = new Set(["baseline", "constrained baseline", "main", "high"]);
const DIRECT_PLAY_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p"]);
const DIRECT_PLAY_AUDIO_CODECS = new Set(["aac", "mp3"]);
const MAX_AUDIO_CHANNELS = 2;
const MAX_FPS = 60;

export function decide(probe: ProbeResult, opts: PolicyOptions): Decision {
  const reasons: string[] = [];
  /** Anything that can't be fixed by a stream copy forces a full re-encode. */
  let mustEncode = false;

  const { video, audio } = probe;

  if (!video) {
    // Audio-only or an unreadable stream list. Re-encoding is the only way to
    // get something Plex will accept, and it will fail loudly if it can't.
    return { action: "encode", reasons: ["No video stream found"] };
  }

  if (!DIRECT_PLAY_VIDEO_CODECS.has(video.codec)) {
    reasons.push(`Video codec is ${video.codec || "unknown"}, not H.264`);
    mustEncode = true;
  } else if (video.profile && !DIRECT_PLAY_VIDEO_PROFILES.has(video.profile.toLowerCase())) {
    reasons.push(`H.264 profile is ${video.profile}, which many clients can't direct play`);
    mustEncode = true;
  }

  if (video.pixelFormat && !DIRECT_PLAY_PIXEL_FORMATS.has(video.pixelFormat)) {
    reasons.push(`Pixel format is ${video.pixelFormat}, not 8-bit 4:2:0`);
    mustEncode = true;
  }

  if (video.height > opts.maxHeight) {
    reasons.push(`${video.height}p exceeds the ${opts.maxHeight}p limit`);
    mustEncode = true;
  }

  if (video.fps > MAX_FPS) {
    reasons.push(`${video.fps.toFixed(2)} fps exceeds ${MAX_FPS} fps`);
    mustEncode = true;
  }

  if (audio) {
    if (!DIRECT_PLAY_AUDIO_CODECS.has(audio.codec)) {
      reasons.push(`Audio codec is ${audio.codec || "unknown"}, not AAC`);
      mustEncode = true;
    }
    if (audio.channels > MAX_AUDIO_CHANNELS) {
      reasons.push(`${audio.channels} audio channels will be downmixed to stereo`);
      mustEncode = true;
    }
  }

  if (mustEncode) return { action: "encode", reasons };

  if (!DIRECT_PLAY_CONTAINERS.has(probe.container)) {
    // Streams are fine; only the wrapper is wrong. A stream copy into mp4 is
    // lossless and near-instant.
    reasons.push(`Container is ${probe.container || "unknown"}, remuxing to MP4`);
    return { action: "remux", reasons };
  }

  // Already an mp4 with compatible streams. We can't tell from a probe where
  // the moov atom sits, but Plex reads prerolls off local disk where that
  // doesn't matter, and our own preview endpoint serves byte ranges — so
  // there's nothing left worth spending CPU on.
  return { action: "copy", reasons: ["Already direct-play compatible"] };
}
