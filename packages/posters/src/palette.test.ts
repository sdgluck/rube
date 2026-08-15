/**
 * The palette is one of the inputs to a poster's `inputHash`, so its
 * determinism isn't cosmetic: a palette that drifted between runs would
 * re-upload every collection's artwork to somebody's Plex server every night.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { DEFAULT_ACCENT, derivePalette, hexToRgb, luminance, rgbToHex, saturation } from "./palette.ts";

function swatch(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 60, height: 90, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

describe("derivePalette", () => {
  it("is deterministic for a given input set", async () => {
    const posters = [await swatch(139, 30, 63), await swatch(27, 108, 168), await swatch(46, 125, 50)];
    const first = await derivePalette(posters);
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(await derivePalette(posters), first, `run ${i} differed`);
    }
  });

  it("picks the most saturated member colour, not the average", async () => {
    const grey = await swatch(120, 120, 120);
    const vivid = await swatch(0, 131, 143);
    const palette = await derivePalette([grey, grey, vivid, grey]);
    assert.notEqual(palette.accent, DEFAULT_ACCENT, "should have found the one colour in the set");
    const accent = hexToRgb(palette.accent)!;
    assert.ok(saturation(accent) > 0.4, `accent ${palette.accent} should be saturated`);
  });

  it("falls back to the default accent when there is no member art at all", async () => {
    const palette = await derivePalette([]);
    assert.equal(palette.accent, DEFAULT_ACCENT);
  });

  it("falls back when every member is grey — a grey is not an accent", async () => {
    const palette = await derivePalette([await swatch(20, 20, 20), await swatch(200, 200, 200)]);
    assert.equal(palette.accent, DEFAULT_ACCENT);
  });

  it("honours an explicit accent over anything the art would have given", async () => {
    const palette = await derivePalette([await swatch(0, 131, 143)], "#E5A00D");
    assert.equal(palette.accent, "#E5A00D");
  });

  it("ignores a member poster that will not decode", async () => {
    const broken = Buffer.from("this is not an image");
    const palette = await derivePalette([broken, await swatch(0, 131, 143)]);
    assert.notEqual(palette.accent, DEFAULT_ACCENT);
  });

  it("always produces a dark plate with a legible title colour", async () => {
    for (const [r, g, b] of [
      [255, 255, 255],
      [0, 0, 0],
      [243, 156, 18],
      [27, 108, 168],
    ]) {
      const palette = await derivePalette([await swatch(r, g, b)]);
      const bg = hexToRgb(palette.bg)!;
      const fg = hexToRgb(palette.fg)!;
      assert.ok(luminance(bg) < 0.35, `bg ${palette.bg} should be dark`);
      assert.ok(Math.abs(luminance(bg) - luminance(fg)) > 0.4, `${palette.fg} on ${palette.bg} lacks contrast`);
    }
  });
});

describe("colour helpers", () => {
  it("round-trips hex through rgb", () => {
    for (const hex of ["#000000", "#FFFFFF", "#E5A00D", "#1B6CA8"]) {
      assert.equal(rgbToHex(hexToRgb(hex)!), hex.toUpperCase());
    }
  });

  it("expands three-digit hex", () => {
    assert.deepEqual(hexToRgb("#f00"), { r: 255, g: 0, b: 0 });
  });

  it("returns null rather than a wrong colour for junk", () => {
    assert.equal(hexToRgb("goldish"), null);
    assert.equal(hexToRgb("#12345"), null);
  });
});
