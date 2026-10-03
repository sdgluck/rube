import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stillArgs } from "./transcode.ts";

describe("stillArgs", () => {
  const args = stillArgs("card.png", "out.mp4", { durationMs: 8000, maxHeight: 720 });
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it("holds the image for exactly the requested length", () => {
    assert.equal(after("-t"), "8.000");
    assert.equal(after("-loop"), "1");
  });

  it("muxes a silent stereo track rather than shipping video-only", () => {
    assert.ok(args.includes("anullsrc=channel_layout=stereo:sample_rate=48000"));
    assert.equal(after("-c:a"), "aac");
  });

  it("caps the height without upscaling, and fades out before the end", () => {
    const vf = after("-vf");
    assert.match(vf, /scale=-2:'min\(ih,720\)'/);
    assert.match(vf, /fade=t=out:st=7\.500/);
  });

  it("encodes the same direct-play profile as an upload", () => {
    assert.equal(after("-c:v"), "libx264");
    assert.equal(after("-profile:v"), "high");
    assert.ok(args.includes("+faststart"));
    assert.equal(args.at(-1), "out.mp4");
  });
});
