import { z } from "zod";
import { syncUsers, getLocalUsers, updateUser } from "../domains/users.ts";
import { t, getPlexClient } from "./_base.ts";

export const usersRouter = t.router({
  list: t.procedure
    .input(
      z.object({
        search: z.string().optional(),
        offset: z.number().default(0),
        limit: z.number().default(50),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(async ({ input }) => {
      const result = getLocalUsers({
        search: input.search || undefined,
        offset: input.offset,
        limit: input.limit,
        sort: input.sort,
        sortDir: input.sortDir,
      });

      // If cache is empty, sync live and retry
      if (result.total === 0 && !input.search) {
        try {
          const client = getPlexClient();
          await syncUsers(client);
          return getLocalUsers({
            search: input.search || undefined,
            offset: input.offset,
            limit: input.limit,
            sort: input.sort,
            sortDir: input.sortDir,
          });
        } catch {
          return result;
        }
      }

      return result;
    }),

  update: t.procedure.input(z.object({ userId: z.number(), name: z.string().optional() })).mutation(({ input }) => {
    updateUser(input.userId, { name: input.name || null });
    return { ok: true };
  }),
});
