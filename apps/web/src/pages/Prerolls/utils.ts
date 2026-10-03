import type { Preroll } from "./types";

export function formatDuration(ms: number): string {
  if (!ms) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  // Prerolls are short, so seconds are the meaningful unit — "0:08" reads
  // better than "8s" next to the occasional "1:20".
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatResolution(preroll: Preroll): string {
  if (!preroll.height) return "—";
  return `${preroll.height}p`;
}

/** True while anything is still being probed or encoded. Drives polling. */
export function hasWorkInFlight(prerolls: Preroll[]): boolean {
  return prerolls.some((p) => p.status === "pending" || p.status === "processing");
}

export const STATUS_LABELS: Record<string, string> = {
  pending: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

/** How the transcoder's decision is phrased in the UI. */
export const ACTION_LABELS: Record<string, string> = {
  copy: "Kept as-is",
  remux: "Remuxed",
  encode: "Re-encoded",
  render: "Generated",
};
