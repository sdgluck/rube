// Browser-side badge SVG generator. Mirrors packages/overlays/src/badge.ts and
// composite.ts so the on-screen preview matches what the server's `sharp`
// pipeline will produce when overlays are actually applied.

import * as opentype from "opentype.js";
import type { BadgeShape, BadgeStyle, ColorPreset, OverlayPosition, OverlayType } from "@tinkerbell/contracts";

export interface BadgeColors {
  bg: string;
  text: string;
}

const COLOR_PRESETS: Record<Exclude<ColorPreset, "auto" | "custom">, BadgeColors> = {
  gold: { bg: "#D4A017", text: "#fff" },
  blue: { bg: "#2563EB", text: "#fff" },
  green: { bg: "#16A34A", text: "#fff" },
  gray: { bg: "#6B7280", text: "#fff" },
  imdb: { bg: "#F5C518", text: "#000" },
  rt: { bg: "#FA320A", text: "#fff" },
  purple: { bg: "#7C3AED", text: "#fff" },
  teal: { bg: "#0D9488", text: "#fff" },
  dark: { bg: "rgba(0,0,0,0.7)", text: "#fff" },
  light: { bg: "#F3F4F6", text: "#111" },
  plex: { bg: "#E5A00D", text: "#1F1F1F" },
  red: { bg: "#DC2626", text: "#fff" },
  orange: { bg: "#EA580C", text: "#fff" },
};

const FONT_SIZE_SCALE: Record<NonNullable<BadgeStyle["fontSize"]>, number> = {
  sm: 1.2,
  md: 1.5,
  lg: 1.875,
  xl: 2.25,
  xxl: 3.0,
};

export function autoBadgeColors(type: OverlayType, value: string): BadgeColors {
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

export function resolveBadgeColors(
  type: OverlayType,
  value: string,
  style: BadgeStyle | null | undefined,
): BadgeColors {
  const auto = autoBadgeColors(type, value);
  if (!style) return auto;
  if (style.colorPreset === "custom" && style.customBg) {
    return { bg: style.customBg, text: style.customText || "#fff" };
  }
  if (style.colorPreset && style.colorPreset !== "auto" && style.colorPreset !== "custom") {
    const preset = COLOR_PRESETS[style.colorPreset as keyof typeof COLOR_PRESETS];
    if (preset) return preset;
  }
  return auto;
}

let fontPromise: Promise<opentype.Font> | null = null;

export function loadBadgeFont(): Promise<opentype.Font> {
  if (fontPromise) return fontPromise;
  fontPromise = fetch("/fonts/Roboto-Bold.ttf")
    .then((r) => {
      if (!r.ok) throw new Error(`font ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => opentype.parse(buf))
    .catch((err) => {
      fontPromise = null;
      throw err;
    });
  return fontPromise;
}

export interface RenderedBadge {
  svg: string;
  width: number;
  height: number;
}

/**
 * Render a single badge to SVG. Mirrors packages/overlays/src/badge.ts so
 * client and server output match.
 */
export function renderBadgeSvg(
  font: opentype.Font,
  type: OverlayType,
  value: string,
  scale: number,
  style: BadgeStyle | null | undefined,
): RenderedBadge {
  const labelText = style?.customLabel || value;
  const colors = resolveBadgeColors(type, value, style);

  const sizeMul = style?.fontSize ? FONT_SIZE_SCALE[style.fontSize] : 1;
  const fontSize = Math.round(14 * scale * sizeMul);
  const paddingX = Math.round(10 * scale * sizeMul);
  const paddingY = Math.round(6 * scale * sizeMul);
  const opacity = style?.opacity ?? 1;
  const advance = font.getAdvanceWidth(labelText, fontSize);
  const baseW = Math.ceil(advance + paddingX * 2);
  const height = fontSize + paddingY * 2;

  const styleHasNonAutoFields =
    !!style &&
    (style.customLabel !== undefined ||
      style.fontSize !== undefined ||
      style.shape !== undefined ||
      style.opacity !== undefined ||
      style.customBg !== undefined ||
      style.customText !== undefined ||
      style.showIcon !== undefined ||
      (style.colorPreset !== undefined && style.colorPreset !== "auto"));

  const shape: BadgeShape = style?.shape ?? "rounded";
  const isTag = shape === "tag" && styleHasNonAutoFields;

  let radius: number;
  if (!styleHasNonAutoFields) {
    radius = Math.round(4 * scale);
  } else if (shape === "pill") {
    radius = Math.round(height / 2);
  } else if (shape === "rect") {
    radius = 0;
  } else {
    radius = Math.round(4 * scale * sizeMul);
  }

  const notch = isTag ? Math.round(height / 2) : 0;
  const width = baseW + notch;

  const tx = (baseW - advance) / 2;
  const ty = height / 2 + fontSize * 0.35;
  const pathData = font.getPath(labelText, tx, ty, fontSize).toPathData(2);

  let bgEl: string;
  if (isTag) {
    const r = radius;
    bgEl = `<path d="M${r} 0 H${baseW} L${width} ${height / 2} L${baseW} ${height} H${r} Q0 ${height} 0 ${height - r} V${r} Q0 0 ${r} 0 Z" fill="${colors.bg}" opacity="${opacity}"/>`;
  } else {
    bgEl = `<rect x="0" y="0" width="${baseW}" height="${height}" rx="${radius}" ry="${radius}" fill="${colors.bg}" opacity="${opacity}"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  ${bgEl}
  <path d="${pathData}" fill="${colors.text}" opacity="${opacity}"/>
</svg>`;

  return { svg, width, height };
}

const REF_WIDTH = 600;
export function badgeScale(imgW: number): number {
  return imgW / REF_WIDTH;
}

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
    case "middle-left":
      return { left: margin, top: Math.round((imgH - badgeH) / 2) };
    case "middle-center":
      return { left: Math.round((imgW - badgeW) / 2), top: Math.round((imgH - badgeH) / 2) };
    case "middle-right":
      return { left: imgW - badgeW - margin, top: Math.round((imgH - badgeH) / 2) };
    case "bottom-left":
      return { left: margin, top: imgH - badgeH - margin };
    case "bottom-center":
      return { left: Math.round((imgW - badgeW) / 2), top: imgH - badgeH - margin };
    case "bottom-right":
      return { left: imgW - badgeW - margin, top: imgH - badgeH - margin };
  }
}
