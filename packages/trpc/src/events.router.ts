import { z } from "zod";
import { getEvents, getEventTypes } from "@tinkerbell/domain.events";
import { t, procedure } from "./_base.ts";
import { paginationInput } from "./_pagination.ts";

export const eventsRouter = t.router({
  list: t.procedure
    .input(
      paginationInput.extend({
        type: z.string().optional(),
        search: z.string().optional(),
        sort: z.string().optional(),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(({ input }) => getEvents(input)),

  types: procedure.query(() => getEventTypes()),
});
