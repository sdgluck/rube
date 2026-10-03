/**
 * The logic behind the quality profile screens, kept out of the components so
 * it can be tested without a DOM.
 */

import { defaultCeiling, gbForRuntime, mbPerMinute, type SizeLimit } from "@tinkerbell/contracts";
import type { StatusChipTone } from "#components/PageShell";

export type ManagedStatus = "unknown" | "in_sync" | "drifted" | "missing" | "update_available";

export const STATUS_LABEL: Record<ManagedStatus, string> = {
  unknown: "Not checked",
  in_sync: "In sync",
  drifted: "Changed outside Tinkerbell",
  missing: "Missing",
  update_available: "Preset updated",
};

export const STATUS_TONE: Record<ManagedStatus, StatusChipTone> = {
  unknown: "advisory",
  in_sync: "ok",
  drifted: "error",
  missing: "error",
  update_available: "running",
};

export function asStatus(status: string): ManagedStatus {
  return status in STATUS_LABEL ? (status as ManagedStatus) : "unknown";
}

/** "per film" for a two-hour basis, "per hour" for a one-hour one, minutes otherwise. */
export function basisLabel(basisMinutes: number): string {
  if (basisMinutes === 120) return "per 2-hour film";
  if (basisMinutes === 60) return "per hour of TV";
  return `per ${basisMinutes} minutes`;
}

/** The runtimes worth showing for a basis: a short one, the basis, a long one. */
export function exampleRuntimes(basisMinutes: number): number[] {
  return basisMinutes >= 90 ? [90, basisMinutes, 180] : [25, basisMinutes, 90];
}

export function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Example sizes for the live preview, before anything is sent to the server. */
export function sizeExamples(limit: SizeLimit): Array<{ minutes: number; gb: number }> {
  const rate = mbPerMinute(limit);
  return exampleRuntimes(limit.basisMinutes).map((minutes) => {
    const gb = gbForRuntime(rate, minutes);
    // The per-file ceiling caps everything, however long.
    return { minutes, gb: limit.ceilingGb === null ? gb : Math.min(gb, limit.ceilingGb) };
  });
}

/**
 * Keep the ceiling sensible while the main limit is edited.
 *
 * A ceiling the user never touched follows the limit. One they set by hand is
 * left alone, unless the limit has overtaken it, because a ceiling below the
 * reference size would reject the releases the limit is asking for.
 */
export function withMaxGb(limit: SizeLimit, maxGb: number, ceilingTouched: boolean): SizeLimit {
  if (limit.ceilingGb === null) return { ...limit, maxGb };
  const ceilingGb = ceilingTouched ? Math.max(limit.ceilingGb, maxGb) : defaultCeiling(maxGb);
  return { ...limit, maxGb, ceilingGb };
}

/** Group a plan's field changes for display: one heading per step. */
export function stepHeading(step: { kind: string; action: string; name?: string }): string {
  if (step.kind === "definitions") return "Quality sizes (instance-wide)";
  if (step.kind === "profile") return `${step.action === "create" ? "Create" : "Update"} profile “${step.name}”`;
  return `${step.action === "create" ? "Create" : "Update"} custom format “${step.name}”`;
}

export function formatChangeValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "unset";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(" › ");
  if (typeof value === "object") {
    // A spec or a size row: show its fields inline rather than as JSON.
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(", ");
  }
  return String(value);
}
