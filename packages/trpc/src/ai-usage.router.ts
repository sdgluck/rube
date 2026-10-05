import type { TrpcDeps } from "./deps.ts";

import { t, procedure } from "./_base.ts";

/**
 * What Settings → AI → Usage reads. The budget itself is an ordinary config
 * key, written through `config.save` like every other setting so it gets the
 * change log and the portable export for free.
 */
export function createAiUsageRouter(deps: Pick<TrpcDeps, "aiUsage">) {
  const { usageSummary } = deps.aiUsage;

  return t.router({
    summary: procedure.query(() => usageSummary()),
  });
}
