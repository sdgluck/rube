import {
  getCachedRecentlyAdded,
  getCachedMostWatched,
  getLibraryOverview,
  getCachedActivitySummary,
  getOpsSummary,
} from "#domains/stats.ts";
import { t, procedure, getPlexClient } from "./_base.ts";

export const statsRouter = t.router({
  sessions: procedure.query(async () => {
    const client = getPlexClient();
    return client.getActiveSessions();
  }),
  recentlyAdded: procedure.query(() => getCachedRecentlyAdded()),
  mostWatched: procedure.query(() => getCachedMostWatched()),
  overview: procedure.query(() => getLibraryOverview()),
  activity: procedure.query(() => getCachedActivitySummary()),
  ops: procedure.query(() => getOpsSummary()),
});
