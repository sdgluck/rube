import { z } from "zod";
import { searchAll } from "#domains/search.ts";
import { t, procedure } from "./_base.ts";

export const searchRouter = t.router({
  global: procedure
    .input(z.object({ query: z.string(), limit: z.number().int().min(1).max(20).default(8) }))
    .query(({ input }) => {
      const hits = searchAll(input.query, input.limit);
      return { hits };
    }),
});
