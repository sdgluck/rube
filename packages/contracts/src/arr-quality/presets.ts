/**
 * The quality profile presets.
 *
 * Each preset is one complete opinion about what "good" means at one
 * resolution: which qualities are allowed and in what order, when to stop
 * upgrading, and which custom formats push a release up or down. They are
 * modelled on the TRaSH guides' profiles, simplified where TRaSH offers a
 * choice. Anime is deliberately absent. It needs its own format library
 * (fansub groups, dual audio, v2 releases) and is a later addition.
 *
 * **Bump `version` whenever a preset's output changes.** The drift job
 * compares the version a profile was applied at with the version here, and
 * reports "update available" when they differ. A changed preset with an
 * unchanged version would silently show every managed profile as drifted
 * rather than offering the update.
 *
 * Presets are per service because the quality vocabularies differ: Radarr's
 * `Remux-1080p` is Sonarr's `Bluray-1080p Remux`. The contracts test checks
 * every name here against a captured schema of each app.
 */

import type { ArrCapability, ArrService } from "../arr.ts";
import type { CustomFormatName } from "./custom-formats.ts";
import type { SizeLimit } from "./limits.ts";

/** A single quality, or a named group whose members rank equally. */
export type PresetQuality = string | { group: string; qualities: string[] };

export interface QualityPreset {
  id: string;
  service: ArrService;
  version: number;
  name: string;
  /** One line for the card. */
  summary: string;
  /** What it is for and what it trades away. */
  description: string;
  resolution: "720p" | "1080p" | "2160p";
  requires: ArrCapability[];
  /** Allowed qualities, **best first**. Everything not listed is disallowed. */
  qualities: PresetQuality[];
  /** A quality or group name from `qualities`. Upgrades stop once it is reached. */
  cutoff: string;
  upgradeAllowed: boolean;
  minFormatScore: number;
  /** Upgrades continue past the quality cutoff until this format score. */
  cutoffFormatScore: number;
  minUpgradeFormatScore: number;
  customFormats: Array<{ name: CustomFormatName; score: number }>;
  /**
   * Per-quality minimum size, MB per minute. Anything smaller is a fake or a
   * starved encode. Compact presets lower these, because their whole point is
   * small, efficient encodes.
   */
  minMbPerMin: Record<string, number>;
  defaultLimit: SizeLimit;
}

/** Applies to every preset: the junk nobody wants at any resolution. */
const UNWANTED: QualityPreset["customFormats"] = [
  { name: "BR-DISK", score: -10000 },
  { name: "LQ", score: -10000 },
  { name: "LQ (Release Title)", score: -10000 },
  { name: "3D", score: -10000 },
  { name: "Upscaled", score: -10000 },
  { name: "Extras", score: -10000 },
  { name: "Obfuscated", score: -10000 },
  { name: "Retags", score: -10000 },
  { name: "Bad Dual Groups", score: -10000 },
  { name: "AV1", score: -10000 },
];

const REPACKS: QualityPreset["customFormats"] = [
  { name: "Repack/Proper", score: 5 },
  { name: "Repack2", score: 6 },
];

const STREAMING: QualityPreset["customFormats"] = [
  { name: "ATVP", score: 100 },
  { name: "DSNP", score: 80 },
  { name: "HMAX", score: 80 },
  { name: "NF", score: 60 },
  { name: "PCOK", score: 60 },
  { name: "AMZN", score: 50 },
];

const WEB_TIERS: QualityPreset["customFormats"] = [
  { name: "WEB Tier 01", score: 1700 },
  { name: "WEB Tier 02", score: 1650 },
  { name: "WEB Tier 03", score: 1600 },
];

const HDR: QualityPreset["customFormats"] = [
  { name: "DV (w/o HDR fallback)", score: -10000 },
  { name: "DV HDR10", score: 1500 },
  { name: "HDR10+", score: 600 },
  { name: "HDR", score: 500 },
];

const AUDIO: QualityPreset["customFormats"] = [
  { name: "TrueHD ATMOS", score: 50 },
  { name: "DTS-HD MA", score: 40 },
  { name: "DD+ ATMOS", score: 30 },
];

/** Ordinary scoring: stop upgrading once a top-tier release is in. */
const SCORING = { upgradeAllowed: true, minFormatScore: 0, cutoffFormatScore: 10000, minUpgradeFormatScore: 1 };

const RADARR_MIN: Record<string, number> = {
  "Bluray-720p": 17.1,
  "WEBDL-720p": 10,
  "WEBRip-720p": 10,
  "Bluray-1080p": 50.4,
  "WEBDL-1080p": 15,
  "WEBRip-1080p": 15,
  "Remux-1080p": 102,
  "Bluray-2160p": 102,
  "WEBDL-2160p": 25,
  "WEBRip-2160p": 25,
};

const SONARR_MIN: Record<string, number> = {
  "HDTV-720p": 10,
  "WEBDL-720p": 10,
  "WEBRip-720p": 10,
  "Bluray-720p": 17.1,
  "HDTV-1080p": 15,
  "WEBDL-1080p": 15,
  "WEBRip-1080p": 15,
  "Bluray-1080p": 50.4,
  "WEBDL-2160p": 25,
  "WEBRip-2160p": 25,
  "Bluray-2160p": 94.6,
};

function only(table: Record<string, number>, names: string[], override: Record<string, number> = {}) {
  return Object.fromEntries(names.map((n) => [n, override[n] ?? table[n] ?? 0]));
}

const WEB_1080 = { group: "WEB 1080p", qualities: ["WEBDL-1080p", "WEBRip-1080p"] };
const WEB_720 = { group: "WEB 720p", qualities: ["WEBDL-720p", "WEBRip-720p"] };
const WEB_2160 = { group: "WEB 2160p", qualities: ["WEBDL-2160p", "WEBRip-2160p"] };

export const QUALITY_PRESETS: readonly QualityPreset[] = [
  // ── Radarr ──────────────────────────────────────────────────────────────
  {
    id: "radarr-hd-bluray-web",
    service: "radarr",
    version: 1,
    name: "HD Bluray + WEB",
    summary: "1080p Bluray encodes, WEB-DL until one exists.",
    description:
      "The sensible default for a 1080p library. Grabs the best WEB release on day one, then upgrades to a Bluray encode from a known-good group. Rejects re-encodes, upscales and disc images.",
    resolution: "1080p",
    requires: ["customFormats"],
    qualities: ["Bluray-1080p", WEB_1080, "Bluray-720p", WEB_720],
    cutoff: "Bluray-1080p",
    ...SCORING,
    customFormats: [
      ...UNWANTED,
      { name: "x265 (HD)", score: -10000 },
      { name: "HD Bluray Tier 01", score: 1800 },
      { name: "HD Bluray Tier 02", score: 1750 },
      { name: "HD Bluray Tier 03", score: 1700 },
      ...WEB_TIERS,
      ...REPACKS,
      ...STREAMING,
    ],
    minMbPerMin: only(RADARR_MIN, [
      "Bluray-1080p",
      "WEBDL-1080p",
      "WEBRip-1080p",
      "Bluray-720p",
      "WEBDL-720p",
      "WEBRip-720p",
    ]),
    defaultLimit: { maxGb: 15, basisMinutes: 120, ceilingGb: 19 },
  },
  {
    id: "radarr-uhd-bluray-web",
    service: "radarr",
    version: 1,
    name: "UHD Bluray + WEB",
    summary: "2160p with HDR and Dolby Vision, WEB-DL until a Bluray encode exists.",
    description:
      "For a 4K screen and the bandwidth to feed it. Prefers Dolby Vision with an HDR10 fallback, and rejects Dolby Vision without one, which shows purple on anything that is not a DV display.",
    resolution: "2160p",
    requires: ["customFormats"],
    qualities: ["Bluray-2160p", WEB_2160],
    cutoff: "Bluray-2160p",
    ...SCORING,
    customFormats: [
      ...UNWANTED,
      ...HDR,
      { name: "UHD Bluray Tier 01", score: 1800 },
      { name: "UHD Bluray Tier 02", score: 1750 },
      { name: "UHD Bluray Tier 03", score: 1700 },
      ...WEB_TIERS,
      ...REPACKS,
      ...STREAMING,
      ...AUDIO,
    ],
    minMbPerMin: only(RADARR_MIN, ["Bluray-2160p", "WEBDL-2160p", "WEBRip-2160p"]),
    defaultLimit: { maxGb: 40, basisMinutes: 120, ceilingGb: 50 },
  },
  {
    id: "radarr-remux-1080p",
    service: "radarr",
    version: 1,
    name: "Remux + WEB 1080p",
    summary: "Untouched 1080p Bluray video and lossless audio.",
    description:
      "For collectors with the disk space. A remux is the disc's own video and audio in a playable container, so there is no encoder to second-guess. Falls back to Bluray encodes and WEB-DL until one appears.",
    resolution: "1080p",
    requires: ["customFormats"],
    qualities: ["Remux-1080p", "Bluray-1080p", WEB_1080],
    cutoff: "Remux-1080p",
    ...SCORING,
    customFormats: [
      ...UNWANTED,
      { name: "x265 (HD)", score: -10000 },
      { name: "Remux Tier 01", score: 1950 },
      { name: "Remux Tier 02", score: 1900 },
      { name: "HD Bluray Tier 01", score: 1800 },
      { name: "HD Bluray Tier 02", score: 1750 },
      ...WEB_TIERS,
      ...REPACKS,
      ...STREAMING,
      ...AUDIO,
    ],
    minMbPerMin: only(RADARR_MIN, ["Remux-1080p", "Bluray-1080p", "WEBDL-1080p", "WEBRip-1080p"]),
    defaultLimit: { maxGb: 35, basisMinutes: 120, ceilingGb: 45 },
  },
  {
    id: "radarr-compact-1080p",
    service: "radarr",
    version: 1,
    name: "Compact 1080p",
    summary: "Small, efficient 1080p. HEVC preferred.",
    description:
      "For tight disks or remote streaming. Treats 1080p sources as equals and prefers HEVC encodes, which are about half the size for the same picture. It gives up the top-tier encoders, who mostly release large x264.",
    resolution: "1080p",
    requires: ["customFormats"],
    qualities: [
      { group: "1080p", qualities: ["Bluray-1080p", "WEBDL-1080p", "WEBRip-1080p"] },
      { group: "720p", qualities: ["Bluray-720p", "WEBDL-720p", "WEBRip-720p"] },
    ],
    cutoff: "1080p",
    ...SCORING,
    customFormats: [...UNWANTED, { name: "x265 (HD)", score: 200 }, ...WEB_TIERS, ...REPACKS],
    minMbPerMin: only(
      RADARR_MIN,
      ["Bluray-1080p", "WEBDL-1080p", "WEBRip-1080p", "Bluray-720p", "WEBDL-720p", "WEBRip-720p"],
      { "Bluray-1080p": 10, "WEBDL-1080p": 5, "WEBRip-1080p": 5, "Bluray-720p": 3, "WEBDL-720p": 3, "WEBRip-720p": 3 },
    ),
    defaultLimit: { maxGb: 6, basisMinutes: 120, ceilingGb: 7.5 },
  },

  // ── Sonarr ──────────────────────────────────────────────────────────────
  {
    id: "sonarr-web-1080p",
    service: "sonarr",
    version: 1,
    name: "WEB-1080p",
    summary: "1080p WEB-DL from the streaming services.",
    description:
      "The sensible default for TV. Almost every show is released as a WEB-DL first, and usually never bettered. Prefers known-good groups and the higher-bitrate services, and rejects re-encodes.",
    resolution: "1080p",
    requires: ["customFormats"],
    qualities: [WEB_1080, "Bluray-1080p", "HDTV-1080p", WEB_720, "Bluray-720p", "HDTV-720p"],
    cutoff: "WEB 1080p",
    ...SCORING,
    customFormats: [...UNWANTED, { name: "x265 (HD)", score: -10000 }, ...WEB_TIERS, ...REPACKS, ...STREAMING],
    minMbPerMin: only(SONARR_MIN, [
      "WEBDL-1080p",
      "WEBRip-1080p",
      "Bluray-1080p",
      "HDTV-1080p",
      "WEBDL-720p",
      "WEBRip-720p",
      "Bluray-720p",
      "HDTV-720p",
    ]),
    defaultLimit: { maxGb: 4, basisMinutes: 60, ceilingGb: 5 },
  },
  {
    id: "sonarr-web-2160p",
    service: "sonarr",
    version: 1,
    name: "WEB-2160p",
    summary: "4K WEB-DL with HDR, 1080p until it exists.",
    description:
      "For 4K screens. Takes the 1080p release on day one and upgrades when a 2160p one appears. Prefers Dolby Vision with an HDR10 fallback, and rejects Dolby Vision without one.",
    resolution: "2160p",
    requires: ["customFormats"],
    qualities: [WEB_2160, "Bluray-2160p", WEB_1080, "Bluray-1080p"],
    cutoff: "WEB 2160p",
    ...SCORING,
    customFormats: [...UNWANTED, ...HDR, ...WEB_TIERS, ...REPACKS, ...STREAMING],
    minMbPerMin: only(SONARR_MIN, [
      "WEBDL-2160p",
      "WEBRip-2160p",
      "Bluray-2160p",
      "WEBDL-1080p",
      "WEBRip-1080p",
      "Bluray-1080p",
    ]),
    defaultLimit: { maxGb: 10, basisMinutes: 60, ceilingGb: 12.5 },
  },
  {
    id: "sonarr-compact-1080p",
    service: "sonarr",
    version: 1,
    name: "Compact WEB-1080p",
    summary: "Small, efficient 1080p TV. HEVC preferred.",
    description:
      "For whole-series hoarding on modest disks. Prefers HEVC encodes of WEB releases, which are about half the size. It gives up some of the top WEB-DL groups, who release untouched H.264.",
    resolution: "1080p",
    requires: ["customFormats"],
    qualities: [WEB_1080, "HDTV-1080p", WEB_720, "HDTV-720p"],
    cutoff: "WEB 1080p",
    ...SCORING,
    customFormats: [...UNWANTED, { name: "x265 (HD)", score: 200 }, ...WEB_TIERS, ...REPACKS],
    minMbPerMin: only(
      SONARR_MIN,
      ["WEBDL-1080p", "WEBRip-1080p", "HDTV-1080p", "WEBDL-720p", "WEBRip-720p", "HDTV-720p"],
      {
        "WEBDL-1080p": 5,
        "WEBRip-1080p": 5,
        "HDTV-1080p": 5,
        "WEBDL-720p": 3,
        "WEBRip-720p": 3,
        "HDTV-720p": 3,
      },
    ),
    defaultLimit: { maxGb: 1.5, basisMinutes: 60, ceilingGb: 2 },
  },
];

const BY_ID = new Map(QUALITY_PRESETS.map((p) => [p.id, p]));

export function qualityPreset(id: string): QualityPreset | undefined {
  return BY_ID.get(id);
}

export function presetsFor(service: ArrService): QualityPreset[] {
  return QUALITY_PRESETS.filter((p) => p.service === service);
}

/** Every quality name a preset allows, groups flattened. */
export function presetQualityNames(preset: QualityPreset): string[] {
  return preset.qualities.flatMap((q) => (typeof q === "string" ? [q] : q.qualities));
}
