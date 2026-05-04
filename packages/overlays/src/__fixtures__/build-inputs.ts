// Regenerator for input poster PNGs. Run manually when fixture inputs need
// to change: `node --experimental-strip-types src/__fixtures__/build-inputs.ts`
// Outputs are committed to inputs/ — tests read them, never run this script.

import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "inputs");

async function makePoster(width: number, height: number, name: string) {
  // Solid mid-gray background. Deterministic; no gradient or noise.
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 64, g: 64, b: 64 } },
  })
    .png()
    .toBuffer();
  const outPath = path.join(outDir, name);
  await sharp(buf).toFile(outPath);
  console.log(`wrote ${outPath} (${buf.length} bytes)`);
}

await makePoster(600, 900, "poster-600x900.png");
await makePoster(1200, 1800, "poster-1200x1800.png");
await makePoster(600, 600, "poster-600x600.png");
