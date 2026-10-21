// Visual regression tests for the overlay compositor.
//
// Each case renders a deterministic PNG and byte-compares against a committed
// golden in __fixtures__/golden/. To bless new or updated goldens after an
// intentional rendering change:
//
//   UPDATE_GOLDENS=1 pnpm --filter @rube/overlays test
//
// Determinism strategy: text is rasterized as SVG paths (see badge.ts) so
// librsvg never performs a font lookup. Output should be byte-identical
// across platforms.
//
// On failure, the actual PNG is written to __fixtures__/actual/<case>.png
// (gitignored) so reviewers can eyeball the diff.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCompositeSharp, type Badge } from "./index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "__fixtures__");
const inputsDir = path.join(fixturesDir, "inputs");
const goldenDir = path.join(fixturesDir, "golden");
const actualDir = path.join(fixturesDir, "actual");

const UPDATE = process.env.UPDATE_GOLDENS === "1";

interface Case {
  name: string;
  input: string;
  badges: Badge[];
}

const CASES: Case[] = [
  {
    name: "single-top-left-resolution-4k",
    input: "poster-600x900.png",
    badges: [{ position: "top-left", type: "resolution", value: "4K" }],
  },
  {
    name: "single-bottom-right-hdr-dv",
    input: "poster-600x900.png",
    badges: [{ position: "bottom-right", type: "hdr", value: "DV" }],
  },
  {
    name: "single-top-center-imdb-8.4",
    input: "poster-600x900.png",
    badges: [{ position: "top-center", type: "imdb_rating", value: "IMDb 8.4" }],
  },
  {
    name: "single-bottom-center-runtime-2h-15m",
    input: "poster-600x900.png",
    badges: [{ position: "bottom-center", type: "runtime", value: "2h 15m" }],
  },
  {
    name: "four-corners-mixed",
    input: "poster-600x900.png",
    badges: [
      { position: "top-left", type: "resolution", value: "4K" },
      { position: "top-right", type: "video_codec", value: "H.265" },
      { position: "bottom-left", type: "audio_channels", value: "5.1" },
      { position: "bottom-right", type: "audio_codec", value: "Atmos" },
    ],
  },
  {
    name: "all-six-positions",
    input: "poster-600x900.png",
    badges: [
      { position: "top-left", type: "resolution", value: "4K" },
      { position: "top-center", type: "imdb_rating", value: "IMDb 8.4" },
      { position: "top-right", type: "video_codec", value: "H.265" },
      { position: "bottom-left", type: "audio_channels", value: "5.1" },
      { position: "bottom-center", type: "runtime", value: "2h 15m" },
      { position: "bottom-right", type: "hdr", value: "DV" },
    ],
  },
  {
    name: "xml-escape-edition",
    input: "poster-600x900.png",
    badges: [{ position: "top-center", type: "edition", value: "A & B <special>" }],
  },
  {
    name: "scale-1200",
    input: "poster-1200x1800.png",
    badges: [{ position: "top-left", type: "resolution", value: "4K" }],
  },
  {
    name: "square-poster-bottom-right",
    input: "poster-600x600.png",
    badges: [{ position: "bottom-right", type: "edition", value: "Director's Cut" }],
  },
];

async function render(c: Case): Promise<Buffer> {
  const poster = fs.readFileSync(path.join(inputsDir, c.input));
  const pipeline = await buildCompositeSharp(poster, c.badges);
  return pipeline.png().toBuffer();
}

describe("overlay visual regression", () => {
  before(() => {
    fs.mkdirSync(goldenDir, { recursive: true });
    if (!UPDATE) fs.mkdirSync(actualDir, { recursive: true });
  });

  for (const c of CASES) {
    it(c.name, async () => {
      const actual = await render(c);
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

      const golden = fs.readFileSync(goldenPath);
      if (!actual.equals(golden)) {
        const out = path.join(actualDir, `${c.name}.png`);
        fs.writeFileSync(out, actual);
        assert.fail(
          `Visual mismatch for "${c.name}". Actual: ${out} (${actual.length} bytes), Golden: ${goldenPath} (${golden.length} bytes). If intentional, run UPDATE_GOLDENS=1 to bless.`,
        );
      }
    });
  }
});
