import { z } from "zod";
import { syncUsers, getLocalUsers, updateUser } from "@tinkerbell/domain.users";
import { t, getPlexClient } from "./_base.ts";
import { paginationInput } from "./_pagination.ts";

export const usersRouter = t.router({
  list: t.procedure
    .input(
      paginationInput.extend({
        search: z.string().optional(),
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

  sync: t.procedure.mutation(async () => {
    const client = getPlexClient();
    return syncUsers(client);
  }),
});
