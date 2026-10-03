/**
 * The config one run executes with.
 *
 * Kept apart from `startJob` so the rule that matters is testable without a
 * queue: a variant's overrides apply to this run only, and the job's locked
 * keys win over everything — no variant may turn "Remove Overlays" into
 * "Apply Overlays".
 */
import { lockedConfigFor, type VariantSpec } from "@tinkerbell/contracts";

export function buildRunConfig(
  job: { id: string; config: Record<string, unknown> | null },
  variant?: VariantSpec,
): Record<string, unknown> {
  return { ...job.config, ...variant?.overrides, ...lockedConfigFor(job.id) };
}
