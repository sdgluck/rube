/* ─── Value formatting ──────────────────────────────────────────────────────
 *
 * One implementation per kind of value, so the same number never renders two
 * different ways on two pages. Previously seven separate `formatDuration`
 * variants were in play and a 90-second job run read as "1:30" on Stats but
 * "1m 30s" everywhere else.
 *
 * Three distinct duration semantics, deliberately kept apart:
 *
 *   formatDuration  how long something took       "1m 30s"   jobs, rules, tests
 *   formatClock     position within a stream      "1:52:30"  playback progress
 *   formatRuntime   how long a piece of media is  "1h 52m"   movie/episode length
 */

/** Placeholder for a value that is absent, unknown or not applicable. */
export const EMPTY = "—";

// ─── Durations ──────────────────────────────────────────────────────────────

/** Elapsed time: `450ms`, `12s`, `1m 30s`, `2h 5m`. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return EMPTY;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

/**
 * Elapsed time between two timestamps. `endMs` omitted or null means "still
 * running", measured against now.
 */
export function formatElapsed(startMs: number, endMs?: number | null): string {
  return formatDuration((endMs ?? Date.now()) - startMs);
}

/** Playback position: `4:07`, `1:52:30`. Seconds are always two digits. */
export function formatClock(ms: number | null | undefined): string {
  if (ms == null) return EMPTY;
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Media length: `48m`, `1h 52m`. */
export function formatRuntime(ms: number | null | undefined): string {
  if (!ms) return EMPTY;
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Process uptime, given seconds: `45s`, `12m`, `3h 20m`, `9d 4h`. */
export function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// ─── Times ──────────────────────────────────────────────────────────────────

/** Absolute timestamp in the viewer's locale. */
export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Compact "time since": `40s ago`, `12m ago`, `3h ago`, `6d ago`. */
export function formatRelativeShort(ts: number): string {
  const sec = Math.floor(Math.max(0, Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Countdown to a future timestamp: `in 4m`, `in 2h 10m`, `due now`. */
export function formatTimeUntil(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "due now";
  return `in ${formatDuration(diff)}`;
}

// ─── Sizes & rates ──────────────────────────────────────────────────────────

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/** Byte count: `840 KB`, `12.4 MB`, `3.21 GB`. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return EMPTY;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

/** Stream bandwidth, given kbps: `680 kbps`, `24.5 Mbps`. */
export function formatBandwidth(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

/**
 * Measured link speed, given Mbps: `18.1 Mbps`, `940 Mbps`.
 *
 * Separate from `formatBandwidth` because the two speak different units —
 * Plex reports session bandwidth in kbps, a bandwidth test reports Mbps — and
 * the Stats tile renders them side by side, where an 8x unit slip would read
 * as a plausible number rather than an obvious bug.
 */
export function formatMbps(mbps: number | null | undefined): string {
  if (mbps == null || mbps <= 0) return EMPTY;
  return mbps >= 100 ? `${Math.round(mbps)} Mbps` : `${mbps.toFixed(1)} Mbps`;
}

/** Track bitrate, given kbps: `640 kbps`, `18.2 Mbps`. */
export function formatBitrate(kbps: number | null | undefined): string {
  if (!kbps) return EMPTY;
  return formatBandwidth(kbps);
}

export function formatSamplingRate(rate: number | null | undefined): string {
  if (!rate) return EMPTY;
  return `${(rate / 1000).toFixed(1)} kHz`;
}

// ─── Media descriptors ──────────────────────────────────────────────────────

export function formatResolution(res: string | null | undefined): string {
  if (!res) return EMPTY;
  if (res === "4k") return "4K";
  return `${res}p`;
}

/**
 * Canonical display names for video and audio codecs. Merged from the two
 * copies that had drifted: the Stats copy was missing `mpeg2video`, so an
 * MPEG-2 file rendered as "MPEG2VIDEO" there and "MPEG-2" on the media page.
 */
const CODEC_NAMES: Record<string, string> = {
  // video
  h264: "H.264",
  hevc: "HEVC",
  h265: "HEVC",
  vp9: "VP9",
  av1: "AV1",
  mpeg4: "MPEG-4",
  vc1: "VC-1",
  mpeg2video: "MPEG-2",
  // audio
  aac: "AAC",
  ac3: "AC3",
  eac3: "EAC3",
  dca: "DTS",
  "dca-ma": "DTS-HD MA",
  truehd: "TrueHD",
  flac: "FLAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  pcm: "PCM",
};

export function formatCodec(codec: string | null | undefined): string {
  if (!codec) return EMPTY;
  return CODEC_NAMES[codec.toLowerCase()] ?? codec.toUpperCase();
}

export function formatChannels(ch: number | null | undefined): string {
  if (!ch) return EMPTY;
  if (ch === 1) return "Mono";
  if (ch === 2) return "Stereo";
  if (ch === 6) return "5.1";
  if (ch === 8) return "7.1";
  return `${ch}ch`;
}
