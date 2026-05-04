import sharp from "sharp";
import type { OverlayPosition, OverlayType } from "./schemas.ts";
import { createBadgeSvg, getBadgeColors } from "./badge.ts";
import { calculatePosition } from "./position.ts";

export interface Badge {
  position: OverlayPosition;
  type: OverlayType;
  value: string;
}

const REF_WIDTH = 600;

function badgeScale(imgW: number): number {
  return imgW / REF_WIDTH;
}

/**
 * Build the composited sharp pipeline up to (but not including) final encoding.
 * Public callers should prefer {@link compositeOverlays}; tests use this seam
 * to encode as PNG (byte-deterministic) instead of JPEG.
 */
export async function buildCompositeSharp(posterBuffer: Buffer, badges: Badge[]): Promise<sharp.Sharp> {
  const image = sharp(posterBuffer);
  const metadata = await image.metadata();
  const imgW = metadata.width || 600;
  const imgH = metadata.height || 900;
  const scale = badgeScale(imgW);

  const composites: sharp.OverlayOptions[] = [];

  for (const badge of badges) {
    const colors = getBadgeColors(badge.type, badge.value);
    const svgBuf = createBadgeSvg(badge.value, colors.bg, colors.text, scale);

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

  return image.composite(composites);
}

export async function compositeOverlays(posterBuffer: Buffer, badges: Badge[]): Promise<Buffer> {
  const pipeline = await buildCompositeSharp(posterBuffer, badges);
  return pipeline.jpeg({ quality: 90 }).toBuffer();
}
