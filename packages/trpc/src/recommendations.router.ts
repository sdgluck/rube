import type { TrpcDeps } from "./deps.ts";

import { t, procedure } from "./_base.ts";

/**
 * What Settings → AI → Built-in recommender reads: whether this build carries
 * the model, and which. The switch itself is the `recommender_enabled` config
 * key, saved through `config.save` so it gets the change log and the portable
 * export like every other setting.
 */
export function createRecommendationsRouter(deps: Pick<TrpcDeps, "recommendations">) {
  const { status } = deps.recommendations;

  return t.router({
    status: procedure.query(() => status()),
  });
}
