import { z } from "zod";
import {
  getCachedRecentlyAdded,
  getMostWatched,
  getLibraryOverview,
  getActivitySummary,
  getOpsSummary,
} from "@tinkerbell/domain.stats";
import {
  allUserTotals,
  HISTORY_SORTS,
  serverHistory,
  userTotals,
  watchedBy,
  watchHistoryCoverage,
} from "@tinkerbell/domain.playback";
import { DAY_MS } from "@tinkerbell/core";
import { t, procedure, getPlexClient } from "./_base.ts";

/**
 * Periods offered by the history-backed panels. `0` means all time — the
 * queries take a `since` timestamp, and 0 is simply the epoch.
 */
const PERIOD_DAYS = [7, 30, 90, 0] as const;
const periodSchema = z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)]).default(7);

function sinceFor(days: number): number {
  return days === 0 ? 0 : Date.now() - days * DAY_MS;
}

export const statsRouter = t.router({
  sessions: procedure.query(async () => {
    const client = getPlexClient();
    return client.getActiveSessions();
  }),
  recentlyAdded: procedure.query(() => getCachedRecentlyAdded()),
  mostWatched: procedure
    .input(z.object({ periodDays: periodSchema }).optional())
    .query(({ input }) => getMostWatched({ since: sinceFor(input?.periodDays ?? 7) })),
  periods: procedure.query(() => PERIOD_DAYS),
  overview: procedure.query(() => getLibraryOverview()),
  activity: procedure.query(() => getActivitySummary()),
  ops: procedure.query(() => getOpsSummary()),

  /**
   * How much playback history there is to filter on.
   *
   * Read by the smart-filter editors: a rule using a watch-history field on a
   * server that has been recording for two days will behave nothing like the
   * user expects, and "it's still filling up" is a far better answer than
   * silence followed by a whole library of results.
   */
  watchHistoryCoverage: procedure.query(() => watchHistoryCoverage()),

  /** Paginated playback history — the Stats history panel. */
  history: procedure
    .input(
      z.object({
        periodDays: periodSchema,
        userId: z.number().optional(),
        ratingKey: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
        sort: z.enum(HISTORY_SORTS).default("when"),
        dir: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .query(({ input }) =>
      serverHistory({
        since: sinceFor(input.periodDays) || undefined,
        userId: input.userId,
        ratingKey: input.ratingKey,
        limit: input.limit,
        offset: input.offset,
        sort: input.sort,
        dir: input.dir,
      }),
    ),

  /** Who has watched an item — the Media detail "Watched by" line. */
  watchedBy: procedure.input(z.object({ ratingKey: z.string() })).query(({ input }) => watchedBy(input.ratingKey)),

  /** Plays and watch time for one user. */
  userPlayback: procedure
    .input(z.object({ userId: z.number(), periodDays: periodSchema }))
    .query(({ input }) => userTotals(input.userId, sinceFor(input.periodDays) || undefined)),

  /**
   * Plays and watch time for every user, for the Users table.
   * Returned as an array because tRPC serialises a Map to `{}`.
   */
  allUserPlayback: procedure.input(z.object({ periodDays: periodSchema }).optional()).query(({ input }) =>
    [...allUserTotals(sinceFor(input?.periodDays ?? 0) || undefined)].map(([userId, totals]) => ({
      userId,
      ...totals,
    })),
  ),
});
