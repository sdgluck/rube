/**
 * Visual regression tests for the collection poster templates.
 *
 * Each case renders a PNG and compares it against a committed golden in
 * `__fixtures__/golden/`. To bless new or updated goldens after an intentional
 * rendering change:
 *
 *   UPDATE_GOLDENS=1 pnpm --filter @rube/posters test
 *
 * Unlike the overlay goldens, these are compared with a **perceptual
 * tolerance** rather than byte-for-byte. Overlays composite small SVG badges
 * onto an input image; these templates resize, blur and JPEG-encode
 * photographic content, and libvips shifts those last bytes subtly between
 * versions. A byte comparison would fail on a `sharp` bump that changed
 * nothing anyone could see, and a suite that cries wolf gets blessed blind.
 *
 * On failure the actual PNG is written to `__fixtures__/actual/<case>.png`
 * (gitignored) so a reviewer can eyeball it.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { COLLECTION_POSTER_HEIGHT, COLLECTION_POSTER_TEMPLATES, COLLECTION_POSTER_WIDTH } from "@rube/contracts";
import { derivePalette } from "./palette.ts";
import { renderCollectionPoster } from "./collection-templates.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "__fixtures__");
const inputsDir = path.join(fixturesDir, "inputs");
const goldenDir = path.join(fixturesDir, "golden");
const actualDir = path.join(fixturesDir, "actual");

const UPDATE = process.env.UPDATE_GOLDENS === "1";

/**
 * Mean absolute per-channel difference, 0–255, allowed before a render counts
 * as changed. Tight enough that a moved title or a dropped mosaic cell fails
 * by orders of magnitude; loose enough to absorb encoder drift.
 */
const TOLERANCE = 2;

const MEMBER_FILES = [
  "member-1-crimson.png",
  "member-2-azure.png",
  "member-3-forest.png",
  "member-4-amber.png",
  "member-5-violet.png",
  "member-6-teal.png",
];

function members(count: number): Buffer[] {
  return MEMBER_FILES.slice(0, count).map((f) => fs.readFileSync(path.join(inputsDir, f)));
}

interface Case {
  name: string;
  template: (typeof COLLECTION_POSTER_TEMPLATES)[number];
  title: string;
  subtitle?: string;
  memberCount: number;
  accent?: string;
}

const CASES: Case[] = [
  // One case per template with plenty of art…
  { name: "gradient-six", template: "gradient", title: "Best of 1994", subtitle: "24 films", memberCount: 6 },
  {
    name: "mosaic-2x2-four",
    template: "mosaic-2x2",
    title: "Directed by Wes Anderson",
    subtitle: "9 films",
    memberCount: 4,
  },
  { name: "mosaic-3x2-six", template: "mosaic-3x2", title: "Science Fiction", subtitle: "112 films", memberCount: 6 },
  { name: "spotlight-six", template: "spotlight", title: "The Lord of the Rings", subtitle: "3 films", memberCount: 6 },

  // …and one per template with none, which is the case that breaks layouts.
  ...COLLECTION_POSTER_TEMPLATES.map((template) => ({
    name: `${template}-empty`,
    template,
    title: "An Empty Collection",
    memberCount: 0,
  })),

  // Fewer members than the grid has cells — the tiling path.
  { name: "mosaic-3x2-two", template: "mosaic-3x2" as const, title: "Two Films Only", memberCount: 2 },
  // A title long enough to force the font down and wrap to the line cap.
  {
    name: "gradient-long-title",
    template: "gradient" as const,
    title: "Films Where Somebody Says The Title Of The Film In The Film",
    memberCount: 3,
  },
  // Characters that would be markup if the title reached the SVG as text.
  { name: "gradient-xml-escape", template: "gradient" as const, title: 'A & B <script> "quoted"', memberCount: 3 },
  // A fixed accent, which must beat whatever the member art would have given.
  {
    name: "mosaic-2x2-accent",
    template: "mosaic-2x2" as const,
    title: "Fixed Accent",
    memberCount: 4,
    accent: "#E5A00D",
  },
];

async function render(c: Case): Promise<Buffer> {
  const memberPosters = members(c.memberCount);
  const palette = await derivePalette(memberPosters, c.accent);
  const jpeg = await renderCollectionPoster(c.template, {
    title: c.title,
    subtitle: c.subtitle,
    memberPosters,
    palette,
  });
  // Compared as PNG so the golden itself carries no JPEG noise; the JPEG
  // encode still happens, so encoder changes are still visible in the diff.
  return sharp(jpeg).png().toBuffer();
}

/** Mean absolute per-channel difference between two same-size PNGs. */
async function meanDifference(a: Buffer, b: Buffer): Promise<number> {
  const [rawA, rawB] = await Promise.all([
    sharp(a).raw().toBuffer({ resolveWithObject: true }),
    sharp(b).raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (rawA.data.length !== rawB.data.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < rawA.data.length; i++) total += Math.abs(rawA.data[i] - rawB.data[i]);
  return total / rawA.data.length;
}

describe("collection poster templates", () => {
  before(() => {
    fs.mkdirSync(goldenDir, { recursive: true });
    if (!UPDATE) fs.mkdirSync(actualDir, { recursive: true });
  });

  for (const c of CASES) {
    it(c.name, async () => {
      const actual = await render(c);

      const meta = await sharp(actual).metadata();
      assert.equal(meta.width, COLLECTION_POSTER_WIDTH, "poster width");
      assert.equal(meta.height, COLLECTION_POSTER_HEIGHT, "poster height");

      const goldenPath = path.join(goldenDir, `${c.name}.png`);
      if (UPDATE) {
        fs.writeFileSync(goldenPath, actual);
        return;
      }
      if (!fs.existsSync(goldenPath)) {
        const out = path.join(actualDir, `${c.name}.png`);
        fs.writeFileSync(out, actual);
        assert.fail(`No golden at ${goldenPath}. Wrote actual to ${out}. Run with UPDATE_GOLDENS=1 to bless.`);
      }

      const diff = await meanDifference(actual, fs.readFileSync(goldenPath));
      if (diff > TOLERANCE) {
        const out = path.join(actualDir, `${c.name}.png`);
        fs.writeFileSync(out, actual);
        assert.fail(
          `Visual mismatch for "${c.name}": mean channel difference ${diff.toFixed(2)} > ${TOLERANCE}. ` +
            `Actual written to ${out}. If intentional, run UPDATE_GOLDENS=1 to bless.`,
        );
      }
    });
  }

  it("every template is covered by at least one case", () => {
    const covered = new Set(CASES.map((c) => c.template));
    for (const template of COLLECTION_POSTER_TEMPLATES) {
      assert.ok(covered.has(template), `no golden case renders the "${template}" template`);
    }
  });

  it("output is JPEG at Plex's poster geometry, for every template", async () => {
    for (const template of COLLECTION_POSTER_TEMPLATES) {
      const memberPosters = members(4);
      const jpeg = await renderCollectionPoster(template, {
        title: "Geometry",
        memberPosters,
        palette: await derivePalette(memberPosters),
      });
      const meta = await sharp(jpeg).metadata();
      assert.equal(meta.format, "jpeg", `${template} must encode as JPEG`);
      assert.equal(meta.width, COLLECTION_POSTER_WIDTH, `${template} width`);
      assert.equal(meta.height, COLLECTION_POSTER_HEIGHT, `${template} height`);
    }
  });
});
