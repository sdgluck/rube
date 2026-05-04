import type { OverlayType } from "./schemas.ts";

export interface MediaInfo {
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  bitDepth?: number;
  colorSpace?: string;
  videoDisplayTitle?: string;
  contentRating?: string;
  duration?: number;
  studio?: string;
  editionTitle?: string;
}

export interface Ratings {
  imdbRating?: string | null;
  rtRating?: string | null;
}

export function resolveOverlayValue(type: OverlayType, mediaInfo: MediaInfo, ratings: Ratings): string | null {
  switch (type) {
    case "resolution": {
      const res = mediaInfo.videoResolution;
      if (!res) return null;
      if (res === "4k" || res === "2160") return "4K";
      if (res === "1080") return "1080p";
      if (res === "720") return "720p";
      if (res === "480" || res === "sd") return "480p";
      return res.toUpperCase();
    }
    case "video_codec": {
      const codec = mediaInfo.videoCodec?.toLowerCase();
      if (!codec) return null;
      if (codec === "hevc" || codec === "h265") return "H.265";
      if (codec === "h264" || codec === "avc") return "H.264";
      if (codec === "av1") return "AV1";
      if (codec === "vp9") return "VP9";
      return codec.toUpperCase();
    }
    case "audio_codec": {
      const audio = mediaInfo.audioCodec?.toLowerCase();
      if (!audio) return null;
      if (audio === "truehd" || audio.includes("atmos")) return "Atmos";
      if (audio === "dts-hd ma" || audio === "dts-x" || audio === "dca-ma") return "DTS-HD MA";
      if (audio === "dts" || audio === "dca") return "DTS";
      if (audio === "eac3" || audio === "ac3") return "Dolby Digital";
      if (audio === "aac") return "AAC";
      if (audio === "flac") return "FLAC";
      return audio.toUpperCase();
    }
    case "content_rating":
      return mediaInfo.contentRating || null;
    case "imdb_rating":
      return ratings.imdbRating ? `IMDb ${ratings.imdbRating}` : null;
    case "rt_rating":
      return ratings.rtRating ? `RT ${ratings.rtRating}` : null;
    case "hdr": {
      const dt = mediaInfo.videoDisplayTitle?.toLowerCase() || "";
      if (dt.includes("dolby vision")) return "DV";
      if (dt.includes("hdr10+")) return "HDR10+";
      if (dt.includes("hdr10")) return "HDR10";
      if (dt.includes("hlg")) return "HLG";
      if (dt.includes("hdr")) return "HDR";
      if (mediaInfo.bitDepth && mediaInfo.bitDepth >= 10 && mediaInfo.colorSpace === "bt2020") return "HDR";
      return null;
    }
    case "audio_channels": {
      const ch = mediaInfo.audioChannels;
      if (ch == null) return null;
      if (ch === 8) return "7.1";
      if (ch === 6) return "5.1";
      if (ch === 2) return "Stereo";
      if (ch === 1) return "Mono";
      return `${ch}ch`;
    }
    case "edition":
      return mediaInfo.editionTitle || null;
    case "studio":
      return mediaInfo.studio || null;
    case "runtime": {
      const ms = mediaInfo.duration;
      if (!ms) return null;
      const totalMin = Math.round(ms / 60000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    }
  }
}
