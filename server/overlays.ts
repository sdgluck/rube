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

export type OverlayType = "resolution" | "video_codec" | "audio_codec" | "content_rating" | "imdb_rating" | "rt_rating";

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
  contentRating?: string;
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
    default:
      return { bg: "rgba(0,0,0,0.7)", text: "#fff" };
  }
}

// ─── SVG badge rendering ────────────────────────────────────────────────────

export function createBadgeSvg(text: string, bgColor: string, textColor: string): Buffer {
  const fontSize = 14;
  const charWidth = 8.5;
  const paddingX = 10;
  const paddingY = 6;
  const width = Math.ceil(text.length * charWidth + paddingX * 2);
  const height = fontSize + paddingY * 2;
  const radius = 4;

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

const MARGIN = 10;

export function calculatePosition(
  position: OverlayPosition,
  imgW: number,
  imgH: number,
  badgeW: number,
  badgeH: number,
): { left: number; top: number } {
  switch (position) {
    case "top-left":
      return { left: MARGIN, top: MARGIN };
    case "top-center":
      return { left: Math.round((imgW - badgeW) / 2), top: MARGIN };
    case "top-right":
      return { left: imgW - badgeW - MARGIN, top: MARGIN };
    case "bottom-left":
      return { left: MARGIN, top: imgH - badgeH - MARGIN };
    case "bottom-center":
      return { left: Math.round((imgW - badgeW) / 2), top: imgH - badgeH - MARGIN };
    case "bottom-right":
      return { left: imgW - badgeW - MARGIN, top: imgH - badgeH - MARGIN };
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

  const composites: sharp.OverlayOptions[] = [];

  for (const badge of badges) {
    const colors = getBadgeColors(badge.type, badge.value);
    const svgBuf = createBadgeSvg(badge.value, colors.bg, colors.text);

    // Get SVG dimensions
    const svgMeta = await sharp(svgBuf).metadata();
    const badgeW = svgMeta.width || 80;
    const badgeH = svgMeta.height || 26;

    const pos = calculatePosition(badge.position, imgW, imgH, badgeW, badgeH);

    composites.push({
      input: svgBuf,
      left: Math.max(0, pos.left),
      top: Math.max(0, pos.top),
    });
  }

  return image.composite(composites).jpeg({ quality: 90 }).toBuffer();
}
