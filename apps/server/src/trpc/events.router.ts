import { z } from "zod";
import { getEvents, getEventTypes } from "#domains/events.ts";
import { t, procedure } from "./_base.ts";

export const eventsRouter = t.router({
  list: t.procedure
    .input(
      z.object({
        limit: z.number().default(50),
        offset: z.number().default(0),
        type: z.string().optional(),
        search: z.string().optional(),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(({ input }) => getEvents(input)),

  types: procedure.query(() => getEventTypes()),
});
