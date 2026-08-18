/**
 * The Stats page used to hold two answers to "is this transcoding?" — the tiles
 * looked at `videoDecision` alone, the panel beneath them looked at all three
 * decisions and had a Direct Stream class as well. So one audio-only transcode
 * read "0 transcoding" in the tile, was counted as direct play by the Direct
 * Play tile, and said "Transcode (audio)" in the row underneath.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isTranscoding, playbackLabel, streamKind } from "./streamDecision.ts";

describe("streamKind", () => {
  test("an audio-only transcode is a transcode", () => {
    const s = { decision: "transcode", videoDecision: "copy", audioDecision: "transcode" };
    assert.equal(streamKind(s), "transcode");
    assert.equal(isTranscoding(s), true);
    assert.equal(playbackLabel(s, "—"), "Transcode (audio)");
  });

  test("a video transcode names the video half", () => {
    const s = { decision: "transcode", videoDecision: "transcode", audioDecision: "copy" };
    assert.equal(playbackLabel(s, "—"), "Transcode (video)");
  });

  test("both halves are named when both are transcoded", () => {
    const s = { decision: "transcode", videoDecision: "transcode", audioDecision: "transcode" };
    assert.equal(playbackLabel(s, "—"), "Transcode (video + audio)");
  });

  test("a remux is a direct stream, not direct play", () => {
    // Cheap, but Plex reports it separately and the panel labels it separately —
    // so counting it as direct play made the two disagree about one session.
    const s = { decision: "copy", videoDecision: "copy", audioDecision: "copy" };
    assert.equal(streamKind(s), "direct-stream");
    assert.equal(isTranscoding(s), false);
    assert.equal(playbackLabel(s, "—"), "Direct Stream");
  });

  test("direct play is direct play", () => {
    const s = { decision: "directplay", videoDecision: "directplay", audioDecision: "directplay" };
    assert.equal(streamKind(s), "direct-play");
    assert.equal(playbackLabel(s, "—"), "Direct Play");
  });

  test("an unrecognised decision is passed through rather than guessed at", () => {
    assert.equal(streamKind({ decision: "something-new" }), "unknown");
    assert.equal(playbackLabel({ decision: "something-new" }, "—"), "something-new");
    assert.equal(playbackLabel({}, "—"), "—");
  });
});
