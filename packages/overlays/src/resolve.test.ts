import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveOverlayValue, type MediaInfo, type Ratings } from "./resolve.ts";
import type { OverlayType } from "./schemas.ts";

const NO_RATINGS: Ratings = {};
const NO_MEDIA: MediaInfo = {};

function call(type: OverlayType, media: MediaInfo, ratings: Ratings = NO_RATINGS) {
  return resolveOverlayValue(type, media, ratings);
}

describe("resolveOverlayValue", () => {
  describe("resolution", () => {
    const cases: [string | undefined, string | null][] = [
      ["4k", "4K"],
      ["2160", "4K"],
      ["1080", "1080p"],
      ["720", "720p"],
      ["480", "480p"],
      ["sd", "480p"],
      ["240", "240"],
      [undefined, null],
    ];
    for (const [input, expected] of cases) {
      it(`${input ?? "undefined"} → ${expected}`, () => {
        assert.equal(call("resolution", { videoResolution: input }), expected);
      });
    }
  });

  describe("video_codec", () => {
    const cases: [string | undefined, string | null][] = [
      ["hevc", "H.265"],
      ["h265", "H.265"],
      ["h264", "H.264"],
      ["avc", "H.264"],
      ["av1", "AV1"],
      ["vp9", "VP9"],
      ["mpeg2", "MPEG2"],
      [undefined, null],
    ];
    for (const [input, expected] of cases) {
      it(`${input ?? "undefined"} → ${expected}`, () => {
        assert.equal(call("video_codec", { videoCodec: input }), expected);
      });
    }
  });

  describe("audio_codec", () => {
    const cases: [string | undefined, string | null][] = [
      ["truehd", "Atmos"],
      ["ac3-atmos", "Atmos"],
      ["dts-hd ma", "DTS-HD MA"],
      ["dts-x", "DTS-HD MA"],
      ["dca-ma", "DTS-HD MA"],
      ["dts", "DTS"],
      ["dca", "DTS"],
      ["eac3", "Dolby Digital"],
      ["ac3", "Dolby Digital"],
      ["aac", "AAC"],
      ["flac", "FLAC"],
      ["opus", "OPUS"],
      [undefined, null],
    ];
    for (const [input, expected] of cases) {
      it(`${input ?? "undefined"} → ${expected}`, () => {
        assert.equal(call("audio_codec", { audioCodec: input }), expected);
      });
    }
  });

  describe("hdr", () => {
    it("dolby vision in displayTitle → DV", () => {
      assert.equal(call("hdr", { videoDisplayTitle: "1080p Dolby Vision (HEVC Main 10)" }), "DV");
    });
    it("HDR10+ → HDR10+", () => {
      assert.equal(call("hdr", { videoDisplayTitle: "4k HDR10+ HEVC" }), "HDR10+");
    });
    it("HDR10 → HDR10", () => {
      assert.equal(call("hdr", { videoDisplayTitle: "4k HDR10 HEVC" }), "HDR10");
    });
    it("HLG → HLG", () => {
      assert.equal(call("hdr", { videoDisplayTitle: "HLG content" }), "HLG");
    });
    it("plain HDR → HDR", () => {
      assert.equal(call("hdr", { videoDisplayTitle: "HDR HEVC" }), "HDR");
    });
    it("bitDepth 10 + bt2020 fallback → HDR", () => {
      assert.equal(call("hdr", { bitDepth: 10, colorSpace: "bt2020" }), "HDR");
    });
    it("bitDepth 8 + bt2020 → null", () => {
      assert.equal(call("hdr", { bitDepth: 8, colorSpace: "bt2020" }), null);
    });
    it("no info → null", () => {
      assert.equal(call("hdr", {}), null);
    });
  });

  describe("audio_channels", () => {
    const cases: [number | undefined, string | null][] = [
      [8, "7.1"],
      [6, "5.1"],
      [2, "Stereo"],
      [1, "Mono"],
      [4, "4ch"],
      [undefined, null],
    ];
    for (const [input, expected] of cases) {
      it(`${input ?? "undefined"} → ${expected}`, () => {
        assert.equal(call("audio_channels", { audioChannels: input }), expected);
      });
    }
  });

  describe("runtime", () => {
    it("90 min → 1h 30m", () => {
      assert.equal(call("runtime", { duration: 90 * 60_000 }), "1h 30m");
    });
    it("45 min → 45m", () => {
      assert.equal(call("runtime", { duration: 45 * 60_000 }), "45m");
    });
    it("60 min → 1h 0m", () => {
      assert.equal(call("runtime", { duration: 60 * 60_000 }), "1h 0m");
    });
    it("0 → null", () => {
      assert.equal(call("runtime", { duration: 0 }), null);
    });
    it("undefined → null", () => {
      assert.equal(call("runtime", {}), null);
    });
  });

  describe("rating overlays", () => {
    it("imdb_rating with value", () => {
      assert.equal(call("imdb_rating", NO_MEDIA, { imdbRating: "8.4" }), "IMDb 8.4");
    });
    it("imdb_rating without value", () => {
      assert.equal(call("imdb_rating", NO_MEDIA), null);
    });
    it("rt_rating with value", () => {
      assert.equal(call("rt_rating", NO_MEDIA, { rtRating: "92%" }), "RT 92%");
    });
    it("rt_rating without value", () => {
      assert.equal(call("rt_rating", NO_MEDIA), null);
    });
  });

  describe("passthrough overlays", () => {
    it("content_rating", () => {
      assert.equal(call("content_rating", { contentRating: "PG-13" }), "PG-13");
      assert.equal(call("content_rating", {}), null);
    });
    it("studio", () => {
      assert.equal(call("studio", { studio: "A24" }), "A24");
      assert.equal(call("studio", {}), null);
    });
    it("edition", () => {
      assert.equal(call("edition", { editionTitle: "Director's Cut" }), "Director's Cut");
      assert.equal(call("edition", {}), null);
    });
  });
});
