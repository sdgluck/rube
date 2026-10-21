/**
 * Synthetic poster generator. Produces a deterministic 2:3 PNG from a title +
 * hue using sharp (the same image library the product's overlays package uses).
 * No real artwork is ever fetched — these are abstract gradient posters with
 * the invented title typeset over them.
 */

import sharp from "sharp";

const WIDTH = 400;
const HEIGHT = 600;

const cache = new Map<string, Promise<Buffer>>();

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

/** Greedy word-wrap into at most `maxLines` lines of ~`max` chars. */
function wrap(title: string, max = 13, maxLines = 3): string[] {
  const words = title.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max && line) {
      lines.push(line);
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function svg(title: string, hue: number): string {
  const c1 = `hsl(${hue}, 58%, 26%)`;
  const c2 = `hsl(${(hue + 40) % 360}, 62%, 14%)`;
  const accent = `hsl(${hue}, 70%, 64%)`;
  const lines = wrap(title);
  const lineHeight = 40;
  const blockHeight = lines.length * lineHeight;
  const startY = HEIGHT - 150 - blockHeight + lineHeight;
  const tspans = lines
    .map((l, i) => `<text x="32" y="${startY + i * lineHeight}" class="t">${escapeXml(l)}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.7" cy="0.25" r="0.8">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.45"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <circle cx="300" cy="150" r="74" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="2"/>
  <circle cx="300" cy="150" r="48" fill="none" stroke="${accent}" stroke-opacity="0.25" stroke-width="2"/>
  <rect x="0" y="${HEIGHT - 230}" width="${WIDTH}" height="230" fill="#000" opacity="0.28"/>
  <style>
    .t { fill:#fff; font-family:'Helvetica Neue',Arial,sans-serif; font-size:34px; font-weight:700; letter-spacing:-0.5px; }
    .k { fill:#fff; opacity:0.62; font-family:'Helvetica Neue',Arial,sans-serif; font-size:15px; font-weight:600; letter-spacing:2px; }
  </style>
  ${tspans}
  <text x="32" y="${HEIGHT - 40}" class="k">RUBE · DEMO</text>
  <rect x="32" y="${HEIGHT - 118}" width="44" height="4" rx="2" fill="${accent}"/>
</svg>`;
}

/** Render (and cache) a poster PNG for a title + hue. */
export function poster(title: string, hue: number): Promise<Buffer> {
  const key = `${hue}:${title}`;
  let p = cache.get(key);
  if (!p) {
    p = sharp(Buffer.from(svg(title, hue)))
      .png()
      .toBuffer();
    cache.set(key, p);
  }
  return p;
}
