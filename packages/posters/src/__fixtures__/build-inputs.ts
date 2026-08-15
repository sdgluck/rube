// Regenerator for the member-poster fixtures. Run manually when the inputs
// need to change: `node --experimental-strip-types src/__fixtures__/build-inputs.ts`
// Outputs are committed to inputs/ — tests read them, never run this script.
//
// Six flat colours rather than the overlays package's single grey: the mosaic
// templates are grids, and a grid of one colour can't show a wrong cell order,
// a missing cell, or a seam. The palette derivation also needs something with
// saturation in it to have anything to derive.

import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "inputs");

const MEMBERS = [
  { name: "member-1-crimson.png", background: { r: 139, g: 30, b: 63 } },
  { name: "member-2-azure.png", background: { r: 27, g: 108, b: 168 } },
  { name: "member-3-forest.png", background: { r: 46, g: 125, b: 50 } },
  { name: "member-4-amber.png", background: { r: 243, g: 156, b: 18 } },
  { name: "member-5-violet.png", background: { r: 106, g: 27, b: 154 } },
  { name: "member-6-teal.png", background: { r: 0, g: 131, b: 143 } },
];

for (const { name, background } of MEMBERS) {
  const outPath = path.join(outDir, name);
  await sharp({ create: { width: 600, height: 900, channels: 3, background } })
    .png()
    .toFile(outPath);
  console.log(`wrote ${outPath}`);
}
