/**
 * The collection-generation pass — the job the rest of the engine is named
 * after. A thin adapter over the engine factory in `./generate/index.ts`.
 */
import type { JobContext } from "@tinkerbell/core";
import { ServicesToken } from "@tinkerbell/composition";
import { createGenerateCommand } from "./generate/index.ts";

export type { TestRuleResult, TestCollectionPreview } from "./generate/index.ts";

export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createGenerateCommand>["run"]>[1],
): Promise<void> {
  return createGenerateCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}
