/**
 * The "customise your Plex" card: one 1920×1080 frame telling whoever is about
 * to watch a film where the portal is, held for a few seconds as a preroll.
 *
 * Drawn as SVG with every string turned into path data by the overlays
 * package's bundled font, then rasterised by sharp. Not ffmpeg's `drawtext`:
 * that needs an ffmpeg built with libfreetype *and* a font on the host, and
 * the failure is an encode error the admin can do nothing about. sharp and the
 * font already ship for overlays.
 *
 * The layout is a pure function of its input so it can be tested without
 * rasterising, and so the preview the admin sees in Settings is the same frame
 * the job encodes — not an HTML approximation of it.
 */
import { rename, rm } from "node:fs/promises";
import sharp from "sharp";
import { encode } from "uqr";
import { fitText, measureText, textPathData } from "@rube/overlays";

export const CARD_WIDTH = 1920;
export const CARD_HEIGHT = 1080;

const MARGIN_X = 160;
const QR_SIZE = 520;
const QR_GAP = 120;
/**
 * Without a QR code the text is centred, and a full-width measure leaves a
 * two-line message with one stranded word on its second line.
 */
const CENTRED_WIDTH = 1400;
const LINE_HEIGHT = 1.18;
/** Space between blocks (eyebrow → headline → message → address), in px. */
const BLOCK_GAP = 44;

export type PortalCardContent = {
  /** The address to send people to. Already resolved — never blank here. */
  url: string;
  headline: string;
  message: string;
  /** Small line above the headline: the portal's branding title, if any. */
  eyebrow?: string;
  background: string;
  foreground: string;
  accent: string;
  showQr: boolean;
};

/**
 * What a person should type. The scheme and a bare trailing slash are noise on
 * a TV — browsers add both back — and the shorter string can be drawn larger.
 */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

type Block = { lines: string[]; fontSize: number; fill: string; opacity?: number };

function blockHeight(b: Block): number {
  return b.lines.length * b.fontSize * LINE_HEIGHT;
}

/**
 * Module matrix → one SVG path of unit squares. One path rather than a rect
 * per module keeps a version-10 code (~3,000 dark modules) to one element.
 */
function qrPath(url: string): { d: string; size: number } {
  // `M` survives a smudge or a TV's overscan crop without making a long URL
  // dense enough to need a phone held close. Border 4 is the quiet zone the
  // spec asks for; scanners are noticeably worse without it.
  const qr = encode(url, { ecc: "M", border: 4 });
  let d = "";
  qr.data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return { d, size: qr.size };
}

export function buildPortalCardSvg(content: PortalCardContent): string {
  const showQr = content.showQr && content.url !== "";
  const textWidth = showQr ? CARD_WIDTH - MARGIN_X * 2 - QR_SIZE - QR_GAP : CENTRED_WIDTH;
  const centred = !showQr;

  const blocks: Block[] = [];
  const eyebrow = content.eyebrow?.trim();
  if (eyebrow) {
    blocks.push({
      ...fitText(eyebrow.toUpperCase(), { maxWidth: textWidth, maxLines: 1, maxFontSize: 40, minFontSize: 24 }),
      fill: content.accent,
    });
  }
  blocks.push({
    ...fitText(content.headline, { maxWidth: textWidth, maxLines: 2, maxFontSize: 108, minFontSize: 56 }),
    fill: content.foreground,
  });
  if (content.message.trim()) {
    blocks.push({
      ...fitText(content.message, { maxWidth: textWidth, maxLines: 3, maxFontSize: 50, minFontSize: 30 }),
      fill: content.foreground,
      opacity: 0.78,
    });
  }
  // A URL has no spaces to wrap at, so it gets one line and shrinks to fit.
  blocks.push({
    ...fitText(displayUrl(content.url), { maxWidth: textWidth, maxLines: 1, maxFontSize: 72, minFontSize: 28 }),
    fill: content.accent,
  });

  const total = blocks.reduce((sum, b) => sum + blockHeight(b), 0) + BLOCK_GAP * (blocks.length - 1);
  let top = (CARD_HEIGHT - total) / 2;

  const paths: string[] = [];
  for (const block of blocks) {
    block.lines.forEach((line, i) => {
      // Roboto's cap height puts the baseline ~0.86 em below the line box top.
      const baseline = top + i * block.fontSize * LINE_HEIGHT + block.fontSize * 0.86;
      const x = centred ? (CARD_WIDTH - measureText(line, block.fontSize)) / 2 : MARGIN_X;
      const opacity = block.opacity === undefined ? "" : ` fill-opacity="${block.opacity}"`;
      paths.push(`<path d="${textPathData(line, x, baseline, block.fontSize)}" fill="${block.fill}"${opacity}/>`);
    });
    top += blockHeight(block) + BLOCK_GAP;
  }

  let qr = "";
  if (showQr) {
    const { d, size } = qrPath(content.url);
    const x = CARD_WIDTH - MARGIN_X - QR_SIZE;
    const y = (CARD_HEIGHT - QR_SIZE) / 2;
    // Always dark-on-white whatever the theme: plenty of phone scanners
    // refuse an inverted code, and the quiet zone has to be light to count.
    qr =
      `<rect x="${x}" y="${y}" width="${QR_SIZE}" height="${QR_SIZE}" rx="28" fill="#ffffff"/>` +
      `<path d="${d}" fill="#111111" transform="translate(${x} ${y}) scale(${QR_SIZE / size})" shape-rendering="crispEdges"/>`;
  }

  const accentBar = `<rect x="0" y="0" width="${CARD_WIDTH}" height="12" fill="${content.accent}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">` +
    `<rect width="100%" height="100%" fill="${content.background}"/>` +
    accentBar +
    paths.join("") +
    qr +
    `</svg>`
  );
}

export async function renderPortalCardPng(content: PortalCardContent): Promise<Buffer> {
  return sharp(Buffer.from(buildPortalCardSvg(content)))
    .png()
    .toBuffer();
}

/**
 * The poster frame straight from the rendered card rather than a seek into the
 * encode, which on a short card lands in the fade-in and shows a dim frame.
 */
export async function writePortalCardThumb(png: Buffer, output: string): Promise<void> {
  const tmp = `${output}.tmp.jpg`;
  try {
    await sharp(png).resize({ width: 480 }).jpeg({ quality: 80 }).toFile(tmp);
    await rename(tmp, output);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
