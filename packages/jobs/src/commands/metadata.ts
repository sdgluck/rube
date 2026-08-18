/**
 * The metadata pass, as its own job.
 *
 * Shares the batch engine with `generate` — same selection handlers, same
 * resume, same concurrency — and differs only in which rules it owns. See
 * `runMetadata` for why it is a separate job rather than a branch.
 *
 * The engine is a factory now, so this re-export became a one-line adapter:
 * same `default(ctx, config)` contract, dependencies from the run's scope.
 */
import type { JobContext } from "@tinkerbell/core";
import { ServicesToken } from "@tinkerbell/composition";
import { createGenerateCommand } from "./generate/index.ts";

export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createGenerateCommand>["runMetadata"]>[1],
): Promise<void> {
  return createGenerateCommand(ctx.scope.resolve(ServicesToken)).runMetadata(ctx, config);
}
