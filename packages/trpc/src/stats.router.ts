import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";

import { HISTORY_SORTS } from "@tinkerbell/domain.playback";

import { DAY_MS } from "@tinkerbell/core";
import { t, procedure, mapNotConfiguredClient } from "./_base.ts";

/**
 * Periods offered by the history-backed panels. `0` means all time — the
 * queries take a `since` timestamp, and 0 is simply the epoch.
 */
const PERIOD_DAYS = [7, 30, 90, 0] as const;
const periodSchema = z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)]).default(7);

function sinceFor(days: number): number {
  return days === 0 ? 0 : Date.now() - days * DAY_MS;
}

export function createStatsRouter(deps: Pick<TrpcDeps, "clients" | "media" | "playback" | "stats">) {
  const { clients } = deps;
  const getPlexClient = mapNotConfiguredClient(clients);
  const { media, playback, stats } = deps;
  const {
    getCachedRecentlyAdded,
    getMostWatched,
    getLibraryOverview,
    getActivitySeries,
    getActivitySummary,
    getOpsSummary,
  } = stats;
  const {
    allUserTotals,
    playbackBreakdown,
    playsByHour,
    serverHistory,
    topUsers,
    userTotals,
    watchedBy,
    watchHistoryCoverage,
  } = playback;
  const { getStorageBySection } = media;

  const statsRouter = t.router({
    sessions: procedure.query(async () => {
      const client = getPlexClient();
      return client.getActiveSessions();
    }),
    recentlyAdded: procedure.query(() => getCachedRecentlyAdded()),
    /**
     * The period's top items, ranked either by plays or by how many different
     * people played them.
     *
     * `rank` is a server concern rather than a column the table sorts on: it
     * decides which rows make the top ten in the first place.
     */
    mostWatched: procedure
      .input(z.object({ periodDays: periodSchema, rank: z.enum(["plays", "viewers"]).default("plays") }).optional())
      .query(({ input }) => getMostWatched({ since: sinceFor(input?.periodDays ?? 7), rank: input?.rank ?? "plays" })),
    periods: procedure.query(() => PERIOD_DAYS),
    overview: procedure.query(() => getLibraryOverview()),
    activity: procedure.query(() => getActivitySummary()),
    activitySeries: procedure
      .input(z.object({ days: z.number().int().min(2).max(90) }).optional())
      .query(({ input }) => getActivitySeries(input?.days ?? 14)),
    ops: procedure.query(() => getOpsSummary()),

    /** Who watched the most in a period — the Top Users panel. */
    topUsers: procedure
      .input(z.object({ periodDays: periodSchema, limit: z.number().int().min(1).max(50).default(10) }).optional())
      .query(({ input }) =>
        topUsers({ since: sinceFor(input?.periodDays ?? 7) || undefined, limit: input?.limit ?? 10 }),
      ),

    /**
     * Apps, devices, transcode decisions and local/remote splits for a period.
     *
     * One endpoint for what the Devices & Apps and Stream Quality panels both
     * ask, so having both on screen costs one query rather than two.
     */
    playbackBreakdown: procedure
      .input(z.object({ periodDays: periodSchema }).optional())
      .query(({ input }) => playbackBreakdown({ since: sinceFor(input?.periodDays ?? 7) || undefined })),

    /** Plays per hour of the local day — the Playback Activity panel. */
    playsByHour: procedure
      .input(z.object({ periodDays: periodSchema }).optional())
      .query(({ input }) => playsByHour({ since: sinceFor(input?.periodDays ?? 7) || undefined })),

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
     * Bytes per library, and how much of each library the figure covers.
     *
     * Read straight from the media index rather than from Plex, so this costs one
     * local query and no round trip.
     *
     * Filling that index is not free, though, and the note here used to imply it
     * was: a movie's size comes with the listing the sync already walks, but a
     * show's belongs to its episodes, so a TV library is walked a second time at
     * episode level. One extra paged walk per TV library per sync is what "how much
     * room do my shows take" costs.
     */
    storage: procedure.query(() => getStorageBySection()),

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

  return statsRouter;
}
