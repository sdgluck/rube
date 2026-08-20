/**
 * The handful of value formatters that both the browser and the server need.
 *
 * These used to live only in `apps/web/src/format.ts`, which was fine while
 * the only thing rendering a filter clause in English was the wizard. Now the
 * generate job writes those same sentences into a collection's summary, and
 * the server can't import from `apps/web` — so the two helpers the shared
 * formatter reaches for moved here. `apps/web/src/format.ts` re-exports them,
 * so there is still exactly one implementation of each.
 */

/** Placeholder for a value that is absent, unknown or not applicable. */
export const EMPTY = "—";

/** Media length: `48m`, `1h 52m`. */
export function formatRuntime(ms: number | null | undefined): string {
  if (!ms) return EMPTY;
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatResolution(res: string | null | undefined): string {
  if (!res) return EMPTY;
  if (res === "4k") return "4K";
  return `${res}p`;
}

/** Bytes, in the largest unit that keeps the number readable: `4.2 GB`, `812 KB`. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return EMPTY;
  if (bytes >= 1e15) return `${(bytes / 1e15).toFixed(2)} PB`;
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
