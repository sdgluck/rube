import { z } from "zod";
import type { TrpcDeps } from "./deps.ts";

import { t, procedure } from "./_base.ts";

/**
 * What the Watchlist tab reads and the one thing it can write.
 *
 * There is no `sync` mutation: running the sync is a job (`watchlist-sync`),
 * started through `jobs.start` like every other, so it gets a run row, a log
 * and the same cancel button rather than a bespoke spinner.
 *
 * `retry` is here because the ledger is deliberately sticky — an item that was
 * skipped because Sonarr had no root folder chosen stays skipped after the
 * root folder is chosen, and the alternative to a button is telling somebody
 * to remove the item from their watchlist in the Plex app and add it back.
 */
export function createWatchlistRouter(deps: Pick<TrpcDeps, "watchlist">) {
  const { listWatchlistItems, watchlistCounts, retryWatchlistItem } = deps.watchlist;

  const watchlistRouter = t.router({
    list: procedure.query(() => ({
      items: listWatchlistItems(),
      counts: watchlistCounts(),
    })),

    retry: procedure.input(z.object({ guid: z.string() })).mutation(({ input }) => {
      retryWatchlistItem(input.guid);
      return { ok: true };
    }),
  });

  return watchlistRouter;
}
