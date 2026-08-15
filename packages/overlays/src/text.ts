/**
 * Text as vector paths, from the bundled font.
 *
 * Every string this package draws is rasterised to SVG path data rather than
 * left as a `<text>` element, so librsvg never performs a font lookup. That is
 * what makes the visual goldens byte-stable across machines that have
 * different fonts installed — and it applies just as much to a collection
 * poster's title as to a badge's label, hence this being shared rather than
 * private to `badge.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

let cachedFont: opentype.Font | null = null;

export function loadBundledFont(): opentype.Font {
  if (cachedFont) return cachedFont;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fontPath = path.join(here, "fonts", "Roboto-Bold.ttf");
  const buf = fs.readFileSync(fontPath);
  cachedFont = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return cachedFont;
}

/** Rendered width of `text` at `fontSize`, in px. */
export function measureText(text: string, fontSize: number): number {
  return loadBundledFont().getAdvanceWidth(text, fontSize);
}

/** SVG path data for `text`, with its baseline at (`x`, `y`). */
export function textPathData(text: string, x: number, y: number, fontSize: number): string {
  return loadBundledFont().getPath(text, x, y, fontSize).toPathData(2);
}

/**
 * Greedy word wrap to a pixel width.
 *
 * A word longer than the line (a franchise name with no spaces, a language
 * code jammed against a colon) is emitted on its own overlong line rather than
 * hyphenated — the caller shrinks the font until it fits, which is what
 * {@link fitText} does.
 */
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (measureText(candidate, fontSize) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

export interface FittedText {
  lines: string[];
  fontSize: number;
}

/**
 * The largest size at or below `maxFontSize` at which `text` wraps into at
 * most `maxLines` lines of `maxWidth`, stepping down in whole pixels.
 *
 * Deterministic by construction — no measurement of the *rendered* result, no
 * floating-point search — so the same title always produces the same layout,
 * which is what lets the poster's `inputHash` stand in for its pixels.
 */
export function fitText(
  text: string,
  opts: { maxWidth: number; maxLines: number; maxFontSize: number; minFontSize: number },
): FittedText {
  for (let size = Math.round(opts.maxFontSize); size > opts.minFontSize; size -= 1) {
    const lines = wrapText(text, size, opts.maxWidth);
    if (lines.length <= opts.maxLines && lines.every((l) => measureText(l, size) <= opts.maxWidth)) {
      return { lines, fontSize: size };
    }
  }
  const size = Math.round(opts.minFontSize);
  return { lines: wrapText(text, size, opts.maxWidth).slice(0, opts.maxLines), fontSize: size };
}
