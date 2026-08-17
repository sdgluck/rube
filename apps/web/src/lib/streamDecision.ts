/**
 * What Plex is doing with a stream, decided once.
 *
 * The Stats page had two answers to this. The tiles counted
 * `videoDecision === "transcode"`; the Streams panel below them counted
 * `decision`, `videoDecision` *or* `audioDecision`, and had a separate Direct
 * Stream class for a remux. So one audio-only transcode read "0 transcoding" in
 * the tile, was counted as direct play by the Direct Play tile, and displayed
 * "Transcode (audio)" in the row directly underneath.
 *
 * `decision` is the session's overall verdict and the per-stream decisions are
 * the detail; any of the three saying "transcode" means the CPU is working.
 */
export interface StreamDecision {
  decision?: string;
  videoDecision?: string;
  audioDecision?: string;
}

export type StreamKind = "transcode" | "direct-stream" | "direct-play" | "unknown";

export function streamKind(s: StreamDecision): StreamKind {
  if (s.decision === "transcode" || s.videoDecision === "transcode" || s.audioDecision === "transcode") {
    return "transcode";
  }
  // A copy is a remux: the container changes, the streams don't. Cheap, but not
  // direct play, and Plex reports it separately.
  if (s.decision === "copy" || s.videoDecision === "copy" || s.audioDecision === "copy") return "direct-stream";
  if (s.decision === "directplay") return "direct-play";
  return "unknown";
}

export function isTranscoding(s: StreamDecision): boolean {
  return streamKind(s) === "transcode";
}

/** Direct Play / Direct Stream / Transcode, in the words the UI shows. */
export function playbackLabel(s: StreamDecision, fallback: string): string {
  switch (streamKind(s)) {
    case "transcode": {
      // Which half is being transcoded is the part that explains the CPU load.
      const parts: string[] = [];
      if (s.videoDecision === "transcode") parts.push("video");
      if (s.audioDecision === "transcode") parts.push("audio");
      return parts.length > 0 ? `Transcode (${parts.join(" + ")})` : "Transcode";
    }
    case "direct-stream":
      return "Direct Stream";
    case "direct-play":
      return "Direct Play";
    default:
      return s.decision ? s.decision : fallback;
  }
}
