export function formatBandwidth(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

export function formatResolution(res: string | undefined): string {
  if (!res) return "";
  if (res === "4k") return "4K";
  return res + "p";
}

export function formatCodec(codec: string | undefined): string {
  if (!codec) return "";
  const map: Record<string, string> = {
    h264: "H.264",
    hevc: "HEVC",
    h265: "HEVC",
    vp9: "VP9",
    av1: "AV1",
    mpeg4: "MPEG-4",
    vc1: "VC-1",
    aac: "AAC",
    ac3: "AC3",
    eac3: "EAC3",
    dca: "DTS",
    "dca-ma": "DTS-HD MA",
    truehd: "TrueHD",
    flac: "FLAC",
    mp3: "MP3",
    opus: "Opus",
    vorbis: "Vorbis",
    pcm: "PCM",
  };
  return map[codec.toLowerCase()] || codec.toUpperCase();
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function formatRelativeShort(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
