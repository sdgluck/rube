import { eq, and } from "drizzle-orm";
import sharp from "sharp";
import { db } from "./db/index.ts";
import { overlayConfigs, overlayOriginals } from "./db/schema.ts";
import type { PlexMediaFullDetail } from "./plex.ts";

// ─── Overlay types ──────────────────────────────────────────────────────────

export type OverlayPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type OverlayType =
  | "resolution"
  | "video_codec"
  | "audio_codec"
  | "content_rating"
  | "imdb_rating"
  | "rt_rating"
  | "hdr"
  | "audio_channels"
  | "edition"
  | "studio"
  | "runtime";

export const OVERLAY_POSITIONS: OverlayPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export const OVERLAY_TYPES: OverlayType[] = [
  "resolution",
  "video_codec",
  "audio_codec",
  "content_rating",
  "imdb_rating",
  "rt_rating",
  "hdr",
  "audio_channels",
  "edition",
  "studio",
  "runtime",
];

// ─── Config CRUD ────────────────────────────────────────────────────────────

export function getOverlayConfigs(sectionId: string) {
  return db.select().from(overlayConfigs).where(eq(overlayConfigs.sectionId, sectionId)).all();
}

export function setOverlayConfig(sectionId: string, position: OverlayPosition, overlayType: OverlayType) {
  const id = `${sectionId}:${position}`;
  db.insert(overlayConfigs)
    .values({ id, sectionId, position, overlayType, createdAt: Date.now() })
    .onConflictDoUpdate({
      target: overlayConfigs.id,
      set: { overlayType, createdAt: Date.now() },
    })
    .run();
}

export function removeOverlayConfig(sectionId: string, position: OverlayPosition) {
  const id = `${sectionId}:${position}`;
  db.delete(overlayConfigs).where(eq(overlayConfigs.id, id)).run();
}

export function clearOverlayConfigs(sectionId: string) {
  db.delete(overlayConfigs).where(eq(overlayConfigs.sectionId, sectionId)).run();
}

// ─── Original poster tracking ───────────────────────────────────────────────

export function getOriginalPoster(ratingKey: string) {
  return db.select().from(overlayOriginals).where(eq(overlayOriginals.ratingKey, ratingKey)).get();
}

export function saveOriginalPoster(ratingKey: string, sectionId: string, originalPosterUrl: string) {
  db.insert(overlayOriginals)
    .values({ ratingKey, sectionId, originalPosterUrl, appliedAt: Date.now() })
    .onConflictDoNothing()
    .run();
}

export function removeOriginalPoster(ratingKey: string) {
  db.delete(overlayOriginals).where(eq(overlayOriginals.ratingKey, ratingKey)).run();
}

export function getOverlaidItems(sectionId: string) {
  return db.select().from(overlayOriginals).where(eq(overlayOriginals.sectionId, sectionId)).all();
}

export function getOverlaidItemCount(sectionId: string): number {
  const rows = db.select().from(overlayOriginals).where(eq(overlayOriginals.sectionId, sectionId)).all();
  return rows.length;
}

// ─── Overlay value resolution ───────────────────────────────────────────────

interface MediaInfo {
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  bitDepth?: number;
  colorSpace?: string;
  videoDisplayTitle?: string;
  contentRating?: string;
  duration?: number;
  studio?: string;
  editionTitle?: string;
}

interface Ratings {
  imdbRating?: string | null;
  rtRating?: string | null;
}

export function resolveOverlayValue(type: OverlayType, mediaInfo: MediaInfo, ratings: Ratings): string | null {
  switch (type) {
    case "resolution": {
      const res = mediaInfo.videoResolution;
      if (!res) return null;
      if (res === "4k" || res === "2160") return "4K";
      if (res === "1080") return "1080p";
      if (res === "720") return "720p";
      if (res === "480" || res === "sd") return "480p";
      return res.toUpperCase();
    }
    case "video_codec": {
      const codec = mediaInfo.videoCodec?.toLowerCase();
      if (!codec) return null;
      if (codec === "hevc" || codec === "h265") return "H.265";
      if (codec === "h264" || codec === "avc") return "H.264";
      if (codec === "av1") return "AV1";
      if (codec === "vp9") return "VP9";
      return codec.toUpperCase();
    }
    case "audio_codec": {
      const audio = mediaInfo.audioCodec?.toLowerCase();
      if (!audio) return null;
      if (audio === "truehd" || audio.includes("atmos")) return "Atmos";
      if (audio === "dts-hd ma" || audio === "dts-x" || audio === "dca-ma") return "DTS-HD MA";
      if (audio === "dts" || audio === "dca") return "DTS";
      if (audio === "eac3" || audio === "ac3") return "Dolby Digital";
      if (audio === "aac") return "AAC";
      if (audio === "flac") return "FLAC";
      return audio.toUpperCase();
    }
    case "content_rating":
      return mediaInfo.contentRating || null;
    case "imdb_rating":
      return ratings.imdbRating ? `IMDb ${ratings.imdbRating}` : null;
    case "rt_rating":
      return ratings.rtRating ? `RT ${ratings.rtRating}` : null;
    case "hdr": {
      const dt = mediaInfo.videoDisplayTitle?.toLowerCase() || "";
      if (dt.includes("dolby vision")) return "DV";
      if (dt.includes("hdr10+")) return "HDR10+";
      if (dt.includes("hdr10")) return "HDR10";
      if (dt.includes("hlg")) return "HLG";
      if (dt.includes("hdr")) return "HDR";
      if (mediaInfo.bitDepth && mediaInfo.bitDepth >= 10 && mediaInfo.colorSpace === "bt2020") return "HDR";
      return null;
    }
    case "audio_channels": {
      const ch = mediaInfo.audioChannels;
      if (ch == null) return null;
      if (ch === 8) return "7.1";
      if (ch === 6) return "5.1";
      if (ch === 2) return "Stereo";
      if (ch === 1) return "Mono";
      return `${ch}ch`;
    }
    case "edition":
      return mediaInfo.editionTitle || null;
    case "studio":
      return mediaInfo.studio || null;
    case "runtime": {
      const ms = mediaInfo.duration;
      if (!ms) return null;
      const totalMin = Math.round(ms / 60000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    }
  }
}

// ─── Badge color schemes ────────────────────────────────────────────────────

interface BadgeColors {
  bg: string;
  text: string;
}

export function getBadgeColors(type: OverlayType, value: string): BadgeColors {
  switch (type) {
    case "resolution":
      if (value === "4K") return { bg: "#D4A017", text: "#fff" };
      if (value === "1080p") return { bg: "#2563EB", text: "#fff" };
      if (value === "720p") return { bg: "#16A34A", text: "#fff" };
      return { bg: "#6B7280", text: "#fff" };
    case "imdb_rating":
      return { bg: "#F5C518", text: "#000" };
    case "rt_rating":
      return { bg: "#FA320A", text: "#fff" };
    case "hdr":
      return { bg: "#7C3AED", text: "#fff" };
    case "edition":
      return { bg: "#0D9488", text: "#fff" };
    default:
      return { bg: "rgba(0,0,0,0.7)", text: "#fff" };
  }
}

// ─── SVG badge rendering ────────────────────────────────────────────────────

// Reference width for scaling — badges are designed at this size
const REF_WIDTH = 600;

/**
 * Compute a scale factor so badges are proportional to poster width.
 * A 600px poster gets scale 1, a 1200px poster gets scale 2, etc.
 */
function badgeScale(imgW: number): number {
  return imgW / REF_WIDTH;
}

export function createBadgeSvg(text: string, bgColor: string, textColor: string, scale: number): Buffer {
  const fontSize = Math.round(14 * scale);
  const charWidth = 8.5 * scale;
  const paddingX = Math.round(10 * scale);
  const paddingY = Math.round(6 * scale);
  const width = Math.ceil(text.length * charWidth + paddingX * 2);
  const height = fontSize + paddingY * 2;
  const radius = Math.round(4 * scale);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${bgColor}"/>
  <text x="${width / 2}" y="${height / 2 + fontSize * 0.35}" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="700" fill="${textColor}" text-anchor="middle">${escapeXml(text)}</text>
</svg>`;

  return Buffer.from(svg);
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Position calculation ───────────────────────────────────────────────────

export function calculatePosition(
  position: OverlayPosition,
  imgW: number,
  imgH: number,
  badgeW: number,
  badgeH: number,
  scale: number,
): { left: number; top: number } {
  const margin = Math.round(10 * scale);
  switch (position) {
    case "top-left":
      return { left: margin, top: margin };
    case "top-center":
      return { left: Math.round((imgW - badgeW) / 2), top: margin };
    case "top-right":
      return { left: imgW - badgeW - margin, top: margin };
    case "bottom-left":
      return { left: margin, top: imgH - badgeH - margin };
    case "bottom-center":
      return { left: Math.round((imgW - badgeW) / 2), top: imgH - badgeH - margin };
    case "bottom-right":
      return { left: imgW - badgeW - margin, top: imgH - badgeH - margin };
  }
}

// ─── Compositing ────────────────────────────────────────────────────────────

export interface Badge {
  position: OverlayPosition;
  type: OverlayType;
  value: string;
}

export async function compositeOverlays(posterBuffer: Buffer, badges: Badge[]): Promise<Buffer> {
  const image = sharp(posterBuffer);
  const metadata = await image.metadata();
  const imgW = metadata.width || 600;
  const imgH = metadata.height || 900;
  const scale = badgeScale(imgW);

  const composites: sharp.OverlayOptions[] = [];

  for (const badge of badges) {
    const colors = getBadgeColors(badge.type, badge.value);
    const svgBuf = createBadgeSvg(badge.value, colors.bg, colors.text, scale);

    // Get SVG dimensions
    const svgMeta = await sharp(svgBuf).metadata();
    const badgeW = svgMeta.width || 80;
    const badgeH = svgMeta.height || 26;

    const pos = calculatePosition(badge.position, imgW, imgH, badgeW, badgeH, scale);

    composites.push({
      input: svgBuf,
      left: Math.max(0, pos.left),
      top: Math.max(0, pos.top),
    });
  }

  return image.composite(composites).jpeg({ quality: 90 }).toBuffer();
}
