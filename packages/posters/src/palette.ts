/**
 * Deriving a collection poster's colours from the art it's made of.
 *
 * A set of generated posters that all share one hard-coded palette looks
 * templated; a set whose colours come from their own members looks designed.
 * `sharp.stats()` already computes a dominant colour from a 4096-bin
 * histogram, so this needs no new dependency and no pixel walk of our own.
 *
 * Everything here is deterministic for a given set of input buffers — that is
 * load-bearing, because the palette is one of the inputs to the poster's
 * `inputHash`, and a palette that drifted would re-upload every collection's
 * artwork on every run.
 */
import sharp from "sharp";

export interface Palette {
  /** Page colour. Always dark — Plex renders posters on a dark chrome. */
  bg: string;
  /** Title colour, contrast-checked against `bg`. */
  fg: string;
  /** The one saturated colour: rules, glyphs, the gradient's warm end. */
  accent: string;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Used when there's no member art, or none of it has any colour in it. */
export const DEFAULT_ACCENT = "#E5A00D";

export function hexToRgb(hex: string): Rgb | null {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** Perceived brightness, 0–1. The usual Rec. 601 weighting. */
export function luminance({ r, g, b }: Rgb): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** HSV saturation, 0–1. Used to tell a poster's colour from its greys. */
export function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b);
  if (max === 0) return 0;
  return (max - Math.min(r, g, b)) / max;
}

/** Scale a colour toward black (`amount` < 1) or white (`amount` > 1). */
export function mix(colour: Rgb, target: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: colour.r + (target.r - colour.r) * t,
    g: colour.g + (target.g - colour.g) * t,
    b: colour.b + (target.b - colour.b) * t,
  };
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/**
 * Lift a dominant colour into something usable as an accent.
 *
 * A poster's dominant colour is usually very dark (posters are mostly dark),
 * and a near-black "accent" is not an accent. So the hue is kept and the
 * brightness is pushed into a band that reads against both the dark plate and
 * the white title.
 */
function normaliseAccent(colour: Rgb): Rgb {
  const l = luminance(colour);
  if (l < 0.35) return mix(colour, WHITE, (0.35 - l) * 1.4);
  if (l > 0.78) return mix(colour, BLACK, (l - 0.78) * 1.2);
  return colour;
}

/** The dominant colour of one image, or null when sharp can't read it. */
async function dominantOf(buffer: Buffer): Promise<Rgb | null> {
  try {
    const { dominant } = await sharp(buffer).stats();
    return dominant ? { r: dominant.r, g: dominant.g, b: dominant.b } : null;
  } catch {
    // A member poster that won't decode is a missing input, not a failure —
    // the palette is derived from whatever else came back.
    return null;
  }
}

/**
 * Build a palette from member posters.
 *
 * `accentOverride` short-circuits the derivation entirely: someone who has
 * picked a colour for a rule has said what they want, and re-deriving it from
 * whatever films happen to be in the collection this week would override them
 * every run.
 */
export async function derivePalette(memberPosters: readonly Buffer[], accentOverride?: string): Promise<Palette> {
  const override = accentOverride ? hexToRgb(accentOverride) : null;
  let accent = override;

  if (!accent) {
    const dominants: Rgb[] = [];
    for (const poster of memberPosters) {
      const dominant = await dominantOf(poster);
      if (dominant) dominants.push(dominant);
    }
    // Most saturated wins, in input order on a tie — the collection's one
    // memorable colour rather than the average of everything, which on a mixed
    // set is always the same muddy brown.
    let best: Rgb | null = null;
    let bestSaturation = 0.12; // below this it's a grey, not a colour
    for (const candidate of dominants) {
      const s = saturation(candidate);
      if (s > bestSaturation) {
        best = candidate;
        bestSaturation = s;
      }
    }
    accent = best ? normaliseAccent(best) : hexToRgb(DEFAULT_ACCENT);
  }

  const accentRgb = accent ?? hexToRgb(DEFAULT_ACCENT)!;
  // The plate is the accent dragged almost all the way to black: same hue
  // family, no competition with the title.
  const bgRgb = mix(accentRgb, BLACK, 0.88);
  const fgRgb = luminance(bgRgb) > 0.55 ? { r: 17, g: 17, b: 17 } : WHITE;

  return { bg: rgbToHex(bgRgb), fg: rgbToHex(fgRgb), accent: rgbToHex(accentRgb) };
}
