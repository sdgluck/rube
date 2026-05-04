import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import opentype from "opentype.js";
import type { OverlayType } from "./schemas.ts";

export interface BadgeColors {
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

let cachedFont: opentype.Font | null = null;

function loadFont(): opentype.Font {
  if (cachedFont) return cachedFont;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fontPath = path.join(here, "fonts", "Roboto-Bold.ttf");
  const buf = fs.readFileSync(fontPath);
  cachedFont = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return cachedFont;
}

export function createBadgeSvg(text: string, bgColor: string, textColor: string, scale: number): Buffer {
  const font = loadFont();
  const fontSize = Math.round(14 * scale);
  const paddingX = Math.round(10 * scale);
  const paddingY = Math.round(6 * scale);
  const radius = Math.round(4 * scale);

  const advance = font.getAdvanceWidth(text, fontSize);
  const width = Math.ceil(advance + paddingX * 2);
  const height = fontSize + paddingY * 2;

  // Render text as a path so output is identical across platforms
  // (librsvg ignores @font-face; system font lookup is non-deterministic).
  const tx = (width - advance) / 2;
  const ty = height / 2 + fontSize * 0.35;
  const pathData = font.getPath(text, tx, ty, fontSize).toPathData(2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${bgColor}"/>
  <path d="${pathData}" fill="${textColor}"/>
</svg>`;

  return Buffer.from(svg);
}

export function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
