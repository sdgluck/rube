/**
 * The preview has to agree with the render.
 *
 * `apps/web/src/lib/badgeRender.ts` and `packages/overlays/src/{badge,position,
 * composite}.ts` are two independent implementations of the same geometry and
 * palette. They are duplicated on purpose — the server's path goes through
 * `sharp`, which cannot enter a browser bundle — and the file says so at the
 * top ("Mirrors packages/overlays/src/badge.ts … so client and server output
 * match"). Nothing checked that the mirror was still a mirror.
 *
 * A drift here has an unusually nasty shape. The preview is what the user
 * approves before committing, and committing means **burning the badge into the
 * poster on their Plex server**. A preview that places a badge differently, or
 * colours it differently, doesn't fail — it lies, and the user finds out after
 * the artwork has been rewritten.
 *
 * So the server's copy is imported directly, by relative path, and the two are
 * driven over the same table of inputs. The import reaches outside the app,
 * which is normally a smell; here it is the point, and it costs nothing because
 * `position.ts` imports only a type and a test file never ships.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BadgeStyle, ColorPreset, OverlayPosition, OverlayType } from "@rube/contracts";
import { calculatePosition as serverCalculatePosition } from "../../../../packages/overlays/src/position.ts";
import {
  getBadgeColors as serverAutoColors,
  resolveBadgeColors as serverResolveColors,
} from "../../../../packages/overlays/src/badge.ts";
import { autoBadgeColors, badgeScale, calculatePosition, resolveBadgeColors } from "./badgeRender.ts";

const POSITIONS: OverlayPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

const TYPES: OverlayType[] = [
  "resolution",
  "video_codec",
  "audio_codec",
  "content_rating",
  "imdb_rating",
  "rt_rating",
  "hdr",
  "audio_channels",
  "edition",
  "studio",
  "runtime",
  "show_status",
];

/** A spread of poster sizes, badge sizes and scales, including awkward ones. */
const GEOMETRY: Array<[imgW: number, imgH: number, badgeW: number, badgeH: number, scale: number]> = [
  [600, 900, 100, 40, 1],
  [1000, 1500, 160, 60, 1000 / 600],
  [300, 450, 60, 24, 0.5],
  // Odd numbers, where a rounding difference would show up.
  [601, 901, 101, 41, 1.0017],
  // A badge wider than the poster: the arithmetic still has to agree, even
  // though the result is off-canvas.
  [200, 300, 400, 50, 1],
];

describe("calculatePosition agrees with the server", () => {
  it("for every position, at every size", () => {
    for (const position of POSITIONS) {
      for (const [imgW, imgH, badgeW, badgeH, scale] of GEOMETRY) {
        assert.deepEqual(
          calculatePosition(position, imgW, imgH, badgeW, badgeH, scale),
          serverCalculatePosition(position, imgW, imgH, badgeW, badgeH, scale),
          `${position} at ${imgW}×${imgH}, badge ${badgeW}×${badgeH} @${scale}`,
        );
      }
    }
  });

  it("covers every position the schema allows", () => {
    // A position added to the enum but not to the switch would return
    // `undefined` and place the badge at the origin. The list above is what
    // makes the agreement test meaningful, so it has to stay complete.
    assert.equal(POSITIONS.length, 9);
    for (const position of POSITIONS) {
      const result = calculatePosition(position, 600, 900, 100, 40, 1);
      assert.equal(typeof result.left, "number", `${position} returned nothing`);
      assert.equal(typeof result.top, "number");
    }
  });
});

describe("calculatePosition", () => {
  it("insets the corners by a scaled margin", () => {
    assert.deepEqual(calculatePosition("top-left", 600, 900, 100, 40, 1), { left: 10, top: 10 });
    assert.deepEqual(calculatePosition("top-left", 600, 900, 100, 40, 2), { left: 20, top: 20 });
  });

  it("centres on the axis the position names, and only that axis", () => {
    const topCentre = calculatePosition("top-center", 600, 900, 100, 40, 1);
    assert.equal(topCentre.left, 250, "horizontally centred");
    assert.equal(topCentre.top, 10, "but still at the top margin");

    const middleLeft = calculatePosition("middle-left", 600, 900, 100, 40, 1);
    assert.equal(middleLeft.left, 10);
    assert.equal(middleLeft.top, 430);
  });

  it("measures right and bottom from the far edge", () => {
    assert.deepEqual(calculatePosition("bottom-right", 600, 900, 100, 40, 1), { left: 490, top: 850 });
  });

  it("returns whole pixels", () => {
    // A fractional offset is resampled by sharp on the server and rounded by
    // the browser on the client — the two would disagree by a pixel.
    for (const position of POSITIONS) {
      const { left, top } = calculatePosition(position, 601, 901, 101, 41, 1.0017);
      assert.equal(Number.isInteger(left), true, `${position} left`);
      assert.equal(Number.isInteger(top), true, `${position} top`);
    }
  });
});

describe("badgeScale", () => {
  it("is 1 at the reference width", () => {
    assert.equal(badgeScale(600), 1);
  });

  it("scales linearly with poster width", () => {
    // The server computes the same ratio against the same 600px reference in
    // `composite.ts`. A different reference would size every badge wrongly in
    // the preview.
    assert.equal(badgeScale(1200), 2);
    assert.equal(badgeScale(300), 0.5);
  });
});

describe("badge colours agree with the server", () => {
  it("for every overlay type, on the automatic palette", () => {
    const values = ["4K", "1080p", "720p", "8.1", "92%", "HDR10", "", "anything"];
    for (const type of TYPES) {
      for (const value of values) {
        assert.deepEqual(
          autoBadgeColors(type, value),
          serverAutoColors(type, value),
          `${type} = ${JSON.stringify(value)}`,
        );
      }
    }
  });

  it("for every colour preset", () => {
    const presets: ColorPreset[] = [
      "auto",
      "custom",
      "gold",
      "blue",
      "green",
      "gray",
      "imdb",
      "rt",
      "purple",
      "red",
      "orange",
    ];
    for (const colorPreset of presets) {
      const style = { colorPreset } as BadgeStyle;
      assert.deepEqual(
        resolveBadgeColors("resolution", "4K", style),
        serverResolveColors("resolution", "4K", style),
        colorPreset,
      );
    }
  });

  it("for a custom colour, including the half-filled case", () => {
    const cases: BadgeStyle[] = [
      { colorPreset: "custom", customBg: "#123456", customText: "#abcdef" } as BadgeStyle,
      // No custom text: both sides must pick the same default.
      { colorPreset: "custom", customBg: "#123456" } as BadgeStyle,
      // No custom background: `custom` without one falls back to automatic.
      { colorPreset: "custom", customText: "#abcdef" } as BadgeStyle,
    ];
    for (const style of cases) {
      assert.deepEqual(
        resolveBadgeColors("imdb_rating", "8.1", style),
        serverResolveColors("imdb_rating", "8.1", style),
        JSON.stringify(style),
      );
    }
  });

  it("with no style at all", () => {
    for (const type of TYPES) {
      assert.deepEqual(resolveBadgeColors(type, "x", null), serverResolveColors(type, "x", null));
      assert.deepEqual(resolveBadgeColors(type, "x", undefined), serverResolveColors(type, "x", undefined));
    }
  });
});

describe("autoBadgeColors", () => {
  it("gives each resolution its own colour, and everything else a neutral", () => {
    assert.deepEqual(autoBadgeColors("resolution", "4K"), { bg: "#D4A017", text: "#fff" });
    assert.deepEqual(autoBadgeColors("resolution", "1080p"), { bg: "#2563EB", text: "#fff" });
    assert.deepEqual(autoBadgeColors("resolution", "720p"), { bg: "#16A34A", text: "#fff" });
    assert.deepEqual(autoBadgeColors("resolution", "480p"), { bg: "#6B7280", text: "#fff" });
  });

  it("uses each service's own brand colour", () => {
    // IMDb's yellow needs black text; getting the pair wrong makes the badge
    // unreadable rather than merely wrong.
    assert.deepEqual(autoBadgeColors("imdb_rating", "8.1"), { bg: "#F5C518", text: "#000" });
    assert.deepEqual(autoBadgeColors("rt_rating", "92%"), { bg: "#FA320A", text: "#fff" });
  });

  it("falls back to translucent black for a type with no palette", () => {
    assert.deepEqual(autoBadgeColors("studio", "A24"), { bg: "rgba(0,0,0,0.7)", text: "#fff" });
  });
});

describe("resolveBadgeColors", () => {
  it("a preset beats the automatic palette", () => {
    assert.deepEqual(resolveBadgeColors("resolution", "4K", { colorPreset: "purple" } as BadgeStyle), {
      bg: "#7C3AED",
      text: "#fff",
    });
  });

  it("`auto` means the automatic palette, not a preset named auto", () => {
    assert.deepEqual(
      resolveBadgeColors("resolution", "4K", { colorPreset: "auto" } as BadgeStyle),
      autoBadgeColors("resolution", "4K"),
    );
  });

  it("a custom background without custom text defaults the text to white", () => {
    assert.deepEqual(
      resolveBadgeColors("studio", "A24", { colorPreset: "custom", customBg: "#123456" } as BadgeStyle),
      {
        bg: "#123456",
        text: "#fff",
      },
    );
  });

  it("`custom` with no background falls back rather than rendering nothing", () => {
    // An empty `customBg` would otherwise produce `fill=""`, which renders as
    // black on one side and as transparent on the other.
    assert.deepEqual(
      resolveBadgeColors("imdb_rating", "8.1", { colorPreset: "custom" } as BadgeStyle),
      autoBadgeColors("imdb_rating", "8.1"),
    );
  });

  it("an unknown preset falls back rather than throwing", () => {
    assert.deepEqual(
      resolveBadgeColors("resolution", "4K", { colorPreset: "chartreuse" as ColorPreset } as BadgeStyle),
      autoBadgeColors("resolution", "4K"),
    );
  });
});
