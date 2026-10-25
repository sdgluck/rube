/**
 * Poster layouts for generated collections.
 *
 * Templates are data — a registry keyed by id, each entry a pure
 * `(inputs) => Buffer` — rather than a branch inside the job, so adding one is
 * a new entry here and nothing else. The engine underneath is the same layered
 * `sharp` composition `packages/overlays` already uses, and text is rasterised
 * to SVG paths from the bundled font for the same reason it is there: librsvg
 * never performs a font lookup, so output is stable across machines.
 *
 * **Every template must render with zero member posters.** A collection whose
 * items have no artwork is routine, and a mosaic of four grey rectangles is
 * worse than the typographic plate it would have fallen back to.
 */
import sharp, { type OverlayOptions } from "sharp";
import { fitText, measureText, textPathData } from "@rube/overlays";
import { COLLECTION_POSTER_HEIGHT, COLLECTION_POSTER_WIDTH } from "@rube/contracts";
import type { CollectionPosterTemplateId } from "@rube/contracts";
import { hexToRgb, mix, rgbToHex, type Palette } from "./palette.ts";

const W = COLLECTION_POSTER_WIDTH;
const H = COLLECTION_POSTER_HEIGHT;

/** JPEG quality. 88 is where Plex-sized posters stop gaining visible detail. */
const JPEG_QUALITY = 88;

export interface CollectionPosterInput {
  title: string;
  subtitle?: string;
  /** May be empty — every template must handle that. */
  memberPosters: Buffer[];
  palette: Palette;
}

export interface CollectionPosterTemplate {
  id: CollectionPosterTemplateId;
  label: string;
  render(input: CollectionPosterInput): Promise<Buffer>;
}

// ─── Shared pieces ──────────────────────────────────────────────────────────

const MARGIN = 80;
const TEXT_WIDTH = W - MARGIN * 2;

function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(mix(rgb, { r: 0, g: 0, b: 0 }, amount)) : hex;
}

function svgBuffer(body: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`);
}

/**
 * The title block, bottom-anchored: an accent rule, the wrapped title, and an
 * optional subtitle under it. Returns the SVG fragment and the y of its top
 * edge, so a caller can put a scrim behind exactly the area it covers.
 */
function titleBlock(
  input: CollectionPosterInput,
  opts: { bottom: number; maxLines: number; maxFontSize: number; align: "left" | "center" },
): { svg: string; top: number } {
  const { lines, fontSize } = fitText(input.title, {
    maxWidth: TEXT_WIDTH,
    maxLines: opts.maxLines,
    maxFontSize: opts.maxFontSize,
    minFontSize: 40,
  });
  const lineHeight = Math.round(fontSize * 1.14);
  const subtitleSize = Math.max(28, Math.round(fontSize * 0.34));
  const subtitle = input.subtitle?.trim();
  const subtitleGap = subtitle ? Math.round(subtitleSize * 1.9) : 0;

  // Lay the block out upwards from its bottom edge, so the anchor is stable
  // whether the title takes one line or three.
  let baseline = opts.bottom - (subtitle ? subtitleGap : 0);
  const parts: string[] = [];

  if (subtitle) {
    const x = opts.align === "center" ? (W - measureText(subtitle, subtitleSize)) / 2 : MARGIN;
    parts.push(
      `<path d="${textPathData(subtitle, x, opts.bottom, subtitleSize)}" fill="${input.palette.fg}" opacity="0.72"/>`,
    );
  }

  for (const line of [...lines].reverse()) {
    const x = opts.align === "center" ? (W - measureText(line, fontSize)) / 2 : MARGIN;
    parts.push(`<path d="${textPathData(line, x, baseline, fontSize)}" fill="${input.palette.fg}"/>`);
    baseline -= lineHeight;
  }

  // The rule sits above the first line, at its cap height rather than its
  // baseline, or it reads as underlining the line above.
  const ruleY = baseline - Math.round(fontSize * 0.52);
  const ruleWidth = Math.round(TEXT_WIDTH * 0.22);
  const ruleX = opts.align === "center" ? (W - ruleWidth) / 2 : MARGIN;
  parts.push(`<rect x="${ruleX}" y="${ruleY}" width="${ruleWidth}" height="8" fill="${input.palette.accent}"/>`);

  return { svg: parts.join(""), top: ruleY - 20 };
}

/** A bottom-up black scrim, so a title over artwork stays legible. */
function scrim(top: number, strength = 0.92): string {
  const start = Math.max(0, Math.min(1, top / H));
  return (
    `<defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="${start.toFixed(4)}" stop-color="#000000" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="#000000" stop-opacity="${strength}"/>` +
    `</linearGradient></defs>` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#scrim)"/>`
  );
}

/** The typographic plate every template falls back to when art is missing. */
function gradientPlate(palette: Palette): Buffer {
  const top = darken(palette.accent, 0.62);
  const bottom = darken(palette.bg, 0.35);
  return svgBuffer(
    `<defs><linearGradient id="plate" x1="0" y1="0" x2="0.35" y2="1">` +
      `<stop offset="0" stop-color="${top}"/>` +
      `<stop offset="1" stop-color="${bottom}"/>` +
      `</linearGradient></defs>` +
      `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#plate)"/>`,
  );
}

/**
 * Cover-crop one poster to an exact box. Centre crop, not sharp's `attention`
 * strategy: a poster is already framed by its designer, and `attention` picks
 * its window from an entropy heuristic that differs between libvips builds —
 * which would make the golden images machine-dependent.
 */
async function cover(buffer: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(buffer).resize(width, height, { fit: "cover" }).toBuffer();
}

/**
 * Cell widths for `count` columns across the full width, with the remainder
 * spread over the leading columns. Integer arithmetic, so no seam of
 * background shows through between cells.
 */
function partition(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Fill `count` cells from however many posters there are, cycling when there
 * are too few. Cycling beats leaving holes: a 2×2 of two posters repeated
 * reads as a pattern, a 2×2 with two empty quadrants reads as broken.
 */
function tile(posters: Buffer[], count: number): Buffer[] {
  return Array.from({ length: count }, (_, i) => posters[i % posters.length]);
}

async function mosaic(input: CollectionPosterInput, cols: number, rows: number): Promise<Buffer> {
  const colWidths = partition(W, cols);
  const rowHeights = partition(H, rows);
  const chosen = tile(input.memberPosters, cols * rows);

  const composites: OverlayOptions[] = [];
  let top = 0;
  for (let row = 0; row < rows; row++) {
    let left = 0;
    for (let col = 0; col < cols; col++) {
      const cell = chosen[row * cols + col];
      composites.push({ input: await cover(cell, colWidths[col], rowHeights[row]), left, top });
      left += colWidths[col];
    }
    top += rowHeights[row];
  }

  const block = titleBlock(input, { bottom: H - 110, maxLines: 3, maxFontSize: 104, align: "left" });
  return sharp({ create: { width: W, height: H, channels: 3, background: input.palette.bg } })
    .composite([...composites, { input: svgBuffer(scrim(block.top - 340)) }, { input: svgBuffer(block.svg) }])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

// ─── Templates ──────────────────────────────────────────────────────────────

const gradient: CollectionPosterTemplate = {
  id: "gradient",
  label: "Gradient",
  async render(input) {
    // Centred rather than bottom-anchored: with no artwork there is nothing
    // for the title to sit on top of, and a title pinned to the bottom of an
    // empty plate looks like a rendering failure.
    const block = titleBlock(input, { bottom: Math.round(H * 0.62), maxLines: 4, maxFontSize: 116, align: "center" });
    return sharp(gradientPlate(input.palette))
      .composite([{ input: svgBuffer(block.svg) }])
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  },
};

const mosaic2x2: CollectionPosterTemplate = {
  id: "mosaic-2x2",
  label: "Mosaic (2×2)",
  render: (input) => (input.memberPosters.length === 0 ? gradient.render(input) : mosaic(input, 2, 2)),
};

const mosaic3x2: CollectionPosterTemplate = {
  id: "mosaic-3x2",
  label: "Mosaic (3×2)",
  render: (input) => (input.memberPosters.length === 0 ? gradient.render(input) : mosaic(input, 3, 2)),
};

const HERO_WIDTH = 560;
const HERO_HEIGHT = 840;
const HERO_TOP = 170;

const spotlight: CollectionPosterTemplate = {
  id: "spotlight",
  label: "Spotlight",
  async render(input) {
    const hero = input.memberPosters[0];
    if (!hero) return gradient.render(input);

    const backdrop = await sharp(await cover(hero, W, H))
      .blur(38)
      .modulate({ brightness: 0.42, saturation: 0.85 })
      .toBuffer();
    const card = await cover(hero, HERO_WIDTH, HERO_HEIGHT);
    const heroLeft = Math.round((W - HERO_WIDTH) / 2);

    const block = titleBlock(input, { bottom: H - 130, maxLines: 2, maxFontSize: 88, align: "center" });
    const frame =
      `<rect x="${heroLeft - 6}" y="${HERO_TOP - 6}" width="${HERO_WIDTH + 12}" height="${HERO_HEIGHT + 12}" ` +
      `fill="none" stroke="${input.palette.accent}" stroke-width="6"/>`;

    return sharp(backdrop)
      .composite([
        { input: svgBuffer(scrim(HERO_TOP + HERO_HEIGHT - 120, 0.86)) },
        { input: card, left: heroLeft, top: HERO_TOP },
        { input: svgBuffer(frame) },
        { input: svgBuffer(block.svg) },
      ])
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  },
};

export const COLLECTION_POSTER_TEMPLATE_LIST: readonly CollectionPosterTemplate[] = [
  gradient,
  mosaic2x2,
  mosaic3x2,
  spotlight,
];

const BY_ID = new Map(COLLECTION_POSTER_TEMPLATE_LIST.map((t) => [t.id, t]));

export function collectionPosterTemplate(id: CollectionPosterTemplateId): CollectionPosterTemplate {
  const template = BY_ID.get(id);
  if (!template) throw new Error(`Unknown collection poster template "${id}"`);
  return template;
}

/**
 * Render a collection poster. Always 1000×1500 JPEG, whatever the template.
 *
 * The title is *not* XML-escaped: it never reaches the SVG as text, only as
 * path data traced from the font, so `&` and `<` in a collection name are
 * glyphs rather than markup. It is length-capped, because a pathological title
 * is a pathological amount of path data.
 */
export function renderCollectionPoster(id: CollectionPosterTemplateId, input: CollectionPosterInput): Promise<Buffer> {
  return collectionPosterTemplate(id).render({
    ...input,
    title: input.title.slice(0, 200),
    subtitle: input.subtitle?.slice(0, 120),
  });
}
