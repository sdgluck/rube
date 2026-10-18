import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";

import { t, procedure } from "./_base.ts";
import { paginationInput } from "./_pagination.ts";
import { NativeAdmin } from "@tinkerbell/contracts/native-api";

export function createEventsRouter(deps: Pick<TrpcDeps, "events">) {
  const { events } = deps;
  const { getEvents, getEventTypes } = events;

  const eventsRouter = t.router({
    list: procedure
      .input(
        paginationInput.extend({
          types: z.array(z.string()).default([]),
          search: z.string().optional(),
          sort: z.string().optional(),
          sortDir: z.enum(["asc", "desc"]).default("desc"),
        }),
      )
      .output(NativeAdmin.EventsListOutput)
      .query(({ input }) => getEvents(input)),

    types: procedure.query(() => getEventTypes()),
  });

  return eventsRouter;
}
