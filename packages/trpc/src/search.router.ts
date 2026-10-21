import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { SEARCH_KINDS } from "@rube/domain.search";
import { t, procedure } from "./_base.ts";

export function createSearchRouter(deps: Pick<TrpcDeps, "search">) {
  const { search } = deps;
  const { searchAll } = search;

  const searchRouter = t.router({
    global: procedure
      .input(
        z.object({
          query: z.string(),
          limit: z.number().int().min(1).max(20).default(8),
          /**
           * Narrow the sweep to these kinds. The palette sends it when the query
           * carries a scope prefix (`rule: nolan`); absent means everything.
           */
          kinds: z.array(z.enum(SEARCH_KINDS)).optional(),
        }),
      )
      .query(({ input }) => {
        const hits = searchAll(input.query, input.limit, input.kinds);
        return { hits };
      }),
  });

  return searchRouter;
}
