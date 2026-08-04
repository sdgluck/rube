import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "./policy.ts";
import { parseProbeOutput } from "./probe.ts";
import { encodeArgs, remuxArgs } from "./transcode.ts";
import type { ProbeResult } from "./types.ts";

const OPTS = { maxHeight: 1080 };

function probeOf(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    container: "mov",
    durationMs: 12_000,
    sizeBytes: 4_000_000,
    bitrate: 2_600_000,
    video: { codec: "h264", profile: "High", pixelFormat: "yuv420p", width: 1920, height: 1080, fps: 23.976 },
    audio: { codec: "aac", channels: 2, sampleRate: 48_000 },
    ...overrides,
  };
}

describe("decide", () => {
  test("leaves an already-compatible mp4 alone", () => {
    const result = decide(probeOf(), OPTS);
    assert.equal(result.action, "copy");
  });

  test("remuxes when only the container is wrong", () => {
    const result = decide(probeOf({ container: "matroska" }), OPTS);
    assert.equal(result.action, "remux");
    assert.match(result.reasons.join(" "), /matroska/);
  });

  test("encodes non-H.264 video", () => {
    for (const codec of ["hevc", "vp9", "av1", "mpeg4"]) {
      const result = decide(probeOf({ video: { ...probeOf().video!, codec } }), OPTS);
      assert.equal(result.action, "encode", `expected ${codec} to require an encode`);
    }
  });

  test("encodes 10-bit and non-4:2:0 sources even when the codec is H.264", () => {
    const tenBit = decide(
      probeOf({ video: { ...probeOf().video!, profile: "High 10", pixelFormat: "yuv420p10le" } }),
      OPTS,
    );
    assert.equal(tenBit.action, "encode");

    const chroma = decide(probeOf({ video: { ...probeOf().video!, pixelFormat: "yuv422p" } }), OPTS);
    assert.equal(chroma.action, "encode");
  });

  test("encodes anything taller than the configured cap", () => {
    const uhd = decide(probeOf({ video: { ...probeOf().video!, width: 3840, height: 2160 } }), OPTS);
    assert.equal(uhd.action, "encode");
    assert.match(uhd.reasons.join(" "), /2160p exceeds the 1080p limit/);

    // …and honours a raised cap rather than hard-coding 1080.
    const allowed = decide(probeOf({ video: { ...probeOf().video!, width: 3840, height: 2160 } }), { maxHeight: 2160 });
    assert.equal(allowed.action, "copy");
  });

  test("encodes high frame rates", () => {
    const result = decide(probeOf({ video: { ...probeOf().video!, fps: 120 } }), OPTS);
    assert.equal(result.action, "encode");
  });

  test("encodes surround and non-AAC audio", () => {
    const surround = decide(probeOf({ audio: { codec: "aac", channels: 6, sampleRate: 48_000 } }), OPTS);
    assert.equal(surround.action, "encode");

    const dts = decide(probeOf({ audio: { codec: "dts", channels: 2, sampleRate: 48_000 } }), OPTS);
    assert.equal(dts.action, "encode");
  });

  test("tolerates a silent source", () => {
    const result = decide(probeOf({ audio: null }), OPTS);
    assert.equal(result.action, "copy");
  });

  test("encodes when there is no video stream at all", () => {
    const result = decide(probeOf({ video: null }), OPTS);
    assert.equal(result.action, "encode");
    assert.deepEqual(result.reasons, ["No video stream found"]);
  });

  test("collects every reason, not just the first", () => {
    const result = decide(
      probeOf({
        container: "matroska",
        video: {
          codec: "hevc",
          profile: "Main 10",
          pixelFormat: "yuv420p10le",
          width: 3840,
          height: 2160,
          fps: 23.976,
        },
        audio: { codec: "eac3", channels: 6, sampleRate: 48_000 },
      }),
      OPTS,
    );
    assert.equal(result.action, "encode");
    assert.ok(result.reasons.length >= 4, `expected several reasons, got ${JSON.stringify(result.reasons)}`);
  });
});

describe("parseProbeOutput", () => {
  test("normalises ffprobe's comma-separated container aliases", () => {
    const parsed = parseProbeOutput(
      JSON.stringify({
        format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.512", size: "4000000", bit_rate: "2600000" },
        streams: [],
      }),
    );
    assert.equal(parsed.container, "mov");
    assert.equal(parsed.durationMs, 12_512);
  });

  test("parses rational frame rates and picks the first stream of each type", () => {
    const parsed = parseProbeOutput(
      JSON.stringify({
        format: { format_name: "matroska,webm", duration: "10" },
        streams: [
          {
            codec_type: "video",
            codec_name: "H264",
            profile: "High",
            pix_fmt: "yuv420p",
            width: 1920,
            height: 1080,
            r_frame_rate: "24000/1001",
          },
          { codec_type: "video", codec_name: "mjpeg" },
          { codec_type: "audio", codec_name: "AAC", channels: 2, sample_rate: "48000" },
        ],
      }),
    );
    assert.equal(parsed.video?.codec, "h264");
    assert.ok(Math.abs((parsed.video?.fps ?? 0) - 23.976) < 0.001);
    assert.equal(parsed.audio?.codec, "aac");
  });

  test("survives a stream list with no video or audio", () => {
    const parsed = parseProbeOutput(JSON.stringify({ format: {}, streams: [{ codec_type: "subtitle" }] }));
    assert.equal(parsed.video, null);
    assert.equal(parsed.audio, null);
    assert.equal(parsed.durationMs, 0);
  });
});

describe("ffmpeg arguments", () => {
  test("remux is a pure stream copy", () => {
    const args = remuxArgs("/in.mkv", "/out.mp4");
    assert.ok(args.includes("copy"));
    assert.ok(args.includes("+faststart"));
    assert.ok(!args.includes("libx264"));
  });

  test("encode caps height without upscaling", () => {
    const args = encodeArgs("/in.mkv", "/out.mp4", { maxHeight: 1080 });
    const vf = args[args.indexOf("-vf") + 1];
    assert.equal(vf, "scale=-2:'min(ih,1080)'");
  });

  test("encode only forces a frame rate when the source is too fast", () => {
    assert.ok(!encodeArgs("/in.mkv", "/out.mp4", { maxHeight: 1080, sourceFps: 23.976 }).includes("-r"));
    assert.ok(encodeArgs("/in.mkv", "/out.mp4", { maxHeight: 1080, sourceFps: 120 }).includes("-r"));
  });

  test("encode maps audio optionally so silent sources don't fail", () => {
    assert.ok(encodeArgs("/in.mkv", "/out.mp4", { maxHeight: 1080 }).includes("0:a:0?"));
  });
});
