import { loadBundledFont } from "./text.ts";
import type { BadgeShape, BadgeStyle, ColorPreset, OverlayType } from "./schemas.ts";
import { FONT_SIZE_SCALE } from "./schemas.ts";

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

/** Resolves the final colors for a badge given its type, value, and optional user style. */
export function resolveBadgeColors(type: OverlayType, value: string, style?: BadgeStyle | null): BadgeColors {
  const auto = getBadgeColors(type, value);
  if (!style) return auto;
  if (style.colorPreset === "custom" && style.customBg) {
    return { bg: style.customBg, text: style.customText || "#fff" };
  }
  if (style.colorPreset && style.colorPreset !== "auto" && style.colorPreset !== "custom") {
    const preset = COLOR_PRESETS[style.colorPreset];
    if (preset) return preset;
  }
  return auto;
}

/** Returns true when the style would not change rendering vs. the legacy path. */
function isLegacyStyle(style: BadgeStyle | null | undefined): boolean {
  if (!style) return true;
  const k = Object.keys(style);
  if (k.length === 0) return true;
  // Any field that affects rendering forces the new path.
  if (
    style.customLabel !== undefined ||
    style.fontSize !== undefined ||
    style.shape !== undefined ||
    style.opacity !== undefined ||
    style.customBg !== undefined ||
    style.customText !== undefined ||
    style.showIcon !== undefined
  )
    return false;
  if (style.colorPreset !== undefined && style.colorPreset !== "auto") return false;
  return true;
}

export function createBadgeSvg(text: string, bgColor: string, textColor: string, scale: number): Buffer {
  // Legacy signature — preserved byte-for-byte for golden tests.
  const font = loadBundledFont();
  const fontSize = Math.round(14 * scale);
  const paddingX = Math.round(10 * scale);
  const paddingY = Math.round(6 * scale);
  const radius = Math.round(4 * scale);

  const advance = font.getAdvanceWidth(text, fontSize);
  const width = Math.ceil(advance + paddingX * 2);
  const height = fontSize + paddingY * 2;

  const tx = (width - advance) / 2;
  const ty = height / 2 + fontSize * 0.35;
  const pathData = font.getPath(text, tx, ty, fontSize).toPathData(2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${bgColor}"/>
  <path d="${pathData}" fill="${textColor}"/>
</svg>`;

  return Buffer.from(svg);
}

export interface StyledBadgeSvg {
  svg: Buffer;
  width: number;
  height: number;
}

/**
 * Produce a styled badge SVG. When `style` is null/empty/legacy, the output
 * is byte-identical to {@link createBadgeSvg} so existing visual goldens stay green.
 */
export function createStyledBadgeSvg(
  text: string,
  type: OverlayType,
  value: string,
  scale: number,
  style: BadgeStyle | null | undefined,
): StyledBadgeSvg {
  if (isLegacyStyle(style)) {
    const colors = getBadgeColors(type, value);
    const svg = createBadgeSvg(text, colors.bg, colors.text, scale);
    // Parse width/height from SVG (cheap regex; SVG produced above).
    const w = Number(svg.toString("utf8").match(/width="(\d+)"/)?.[1] ?? 0);
    const h = Number(svg.toString("utf8").match(/height="(\d+)"/)?.[1] ?? 0);
    return { svg, width: w, height: h };
  }

  const font = loadBundledFont();
  const sizeMul = style?.fontSize ? FONT_SIZE_SCALE[style.fontSize] : 1;
  const fontSize = Math.round(14 * scale * sizeMul);
  const paddingX = Math.round(10 * scale * sizeMul);
  const paddingY = Math.round(6 * scale * sizeMul);
  const shape: BadgeShape = style?.shape ?? "rounded";
  const radius =
    shape === "pill"
      ? Math.round((fontSize + paddingY * 2) / 2)
      : shape === "rect"
        ? 0
        : Math.round(4 * scale * sizeMul);

  const colors = resolveBadgeColors(type, value, style);
  const opacity = style?.opacity ?? 1;
  const advance = font.getAdvanceWidth(text, fontSize);
  const baseW = Math.ceil(advance + paddingX * 2);
  const height = fontSize + paddingY * 2;

  // "tag" shape — pointed right edge that adds a small notch.
  const isTag = shape === "tag";
  const notch = isTag ? Math.round(height / 2) : 0;
  const width = baseW + notch;

  const tx = (baseW - advance) / 2;
  const ty = height / 2 + fontSize * 0.35;
  const pathData = font.getPath(text, tx, ty, fontSize).toPathData(2);

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

  return { svg: Buffer.from(svg), width, height };
}

export function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
