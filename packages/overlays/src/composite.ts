import sharp from "sharp";
import type { BadgeStyle, OverlayPosition, OverlayType } from "./schemas.ts";
import { createBadgeSvg, createStyledBadgeSvg, getBadgeColors } from "./badge.ts";
import { calculatePosition } from "./position.ts";

export interface Badge {
  position: OverlayPosition;
  type: OverlayType;
  value: string;
  /** Optional per-badge styling. Omitted/null produces legacy byte-identical output. */
  style?: BadgeStyle | null;
  /** Stack order within the same position (0 is the outermost / closest to corner). */
  order?: number;
}

const REF_WIDTH = 600;
const STACK_GAP = 6; // px between stacked badges, scaled with image

function badgeScale(imgW: number): number {
  return imgW / REF_WIDTH;
}

function isLegacy(b: Badge): boolean {
  if (b.style && Object.keys(b.style).length > 0) {
    // colorPreset=auto with no other fields is still legacy
    const s = b.style;
    if (
      s.customLabel === undefined &&
      s.fontSize === undefined &&
      s.shape === undefined &&
      s.opacity === undefined &&
      s.customBg === undefined &&
      s.customText === undefined &&
      s.showIcon === undefined &&
      (s.colorPreset === undefined || s.colorPreset === "auto")
    ) {
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Build the composited sharp pipeline up to (but not including) final encoding.
 */
export async function buildCompositeSharp(posterBuffer: Buffer, badges: Badge[]): Promise<sharp.Sharp> {
  const image = sharp(posterBuffer);
  const metadata = await image.metadata();
  const imgW = metadata.width || 600;
  const imgH = metadata.height || 900;
  const scale = badgeScale(imgW);

  // Group badges by position, ordered for stacking.
  const groups = new Map<OverlayPosition, Badge[]>();
  for (const b of badges) {
    const list = groups.get(b.position) ?? [];
    list.push(b);
    groups.set(b.position, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  const composites: sharp.OverlayOptions[] = [];

  for (const [position, list] of groups) {
    // Stack vertically — each subsequent badge offset by previous height + gap.
    let stackOffset = 0;
    const gap = Math.round(STACK_GAP * scale);

    for (const badge of list) {
      const labelText = badge.style?.customLabel || badge.value;
      let svgBuf: Buffer;
      let badgeW: number;
      let badgeH: number;

      if (isLegacy(badge)) {
        const colors = getBadgeColors(badge.type, badge.value);
        svgBuf = createBadgeSvg(labelText, colors.bg, colors.text, scale);
        const meta = await sharp(svgBuf).metadata();
        badgeW = meta.width || 80;
        badgeH = meta.height || 26;
      } else {
        const out = createStyledBadgeSvg(labelText, badge.type, badge.value, scale, badge.style);
        svgBuf = out.svg;
        badgeW = out.width;
        badgeH = out.height;
      }

      const pos = calculatePosition(position, imgW, imgH, badgeW, badgeH, scale);
      const isBottom = position.startsWith("bottom");
      const top = isBottom ? pos.top - stackOffset : pos.top + stackOffset;

      composites.push({
        input: svgBuf,
        left: Math.max(0, pos.left),
        top: Math.max(0, top),
      });
      stackOffset += badgeH + gap;
    }
  }

  return image.composite(composites);
}

export async function compositeOverlays(posterBuffer: Buffer, badges: Badge[]): Promise<Buffer> {
  const pipeline = await buildCompositeSharp(posterBuffer, badges);
  return pipeline.jpeg({ quality: 90 }).toBuffer();
}
