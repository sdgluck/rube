/**
 * Finding something you don't have yet, and asking for it.
 *
 * A sibling of `arr`, not a branch of it. `arr.*` is the proxy over servers you
 * already run and the mirror of what they hold; discover's source of truth is
 * TMDb, and the *Arr is where a result *goes*, not where it comes from. The
 * split also keeps the *Arr router's dependencies to the *Arrs.
 *
 * The one interesting decision in this file is that **`add` resolves the
 * candidate server-side**. The *Arrs' POST body must be their own lookup
 * payload verbatim (see `addMovie` in `clients/radarr/src/library.ts`), so the
 * alternative is shipping a whole raw *Arr record down to the browser and
 * accepting it back as the body of a write — a tamper surface for no benefit,
 * on top of a TMDb→TVDb hop that needs an API key the browser must never see.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { searchMulti, fetchTvExternalIds, type TmdbSearchHit } from "@tinkerbell/tmdb";
import { MINIMUM_AVAILABILITY, SERIES_MONITOR_MODES, type ArrService } from "@tinkerbell/contracts";
import { discoverKey, type DiscoverHolding } from "@tinkerbell/domain.arr-library";
import type { TrpcDeps } from "./deps.ts";
import { t, procedure } from "./_base.ts";
import { createArrClients, upstream } from "./arr/_shared.ts";

/** Movies go to Radarr, shows go to Sonarr. There is no third answer. */
function serviceFor(mediaType: "movie" | "tv"): ArrService {
  return mediaType === "movie" ? "radarr" : "sonarr";
}

const EMPTY_HOLDING: DiscoverHolding = { arr: [], plexRatingKey: null };

export function createDiscoverRouter(deps: Pick<TrpcDeps, "arr" | "arrLibrary" | "config">) {
  const { arr, arrLibrary, config } = deps;
  const { requireInstance, radarrFor, sonarrFor } = createArrClients(arr);

  /**
   * A 412 raised here rather than a `NotConfiguredError` left to the middleware,
   * because every call site is inside `upstream()` — which would wrap the plain
   * error into a 502 first, reporting a setup step the user can fix as an
   * upstream that is broken. `requireInstance` throws its 412 directly for the
   * same reason.
   */
  function tmdbConfig() {
    const apiKey = config.getConfig("global_tmdb_api_key");
    if (!apiKey) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "TMDb is not configured" });
    }
    return { apiKey };
  }

  return t.router({
    /**
     * What Discover can do before it is asked to do it.
     *
     * The page needs this to render a "configure TMDb" prompt *instead of*
     * searching. Without it the only way to learn the key is missing is to
     * fire a search that is guaranteed to fail, which is a wasted request and
     * an error state standing in for a setup step.
     */
    status: procedure.query(() => ({
      tmdb: !!config.getConfig("global_tmdb_api_key"),
      radarr: !!arr.resolveArrInstance("radarr"),
      sonarr: !!arr.resolveArrInstance("sonarr"),
    })),

    /**
     * Search TMDb, annotated with what you already hold.
     *
     * A query rather than a mutation: TMDb search is cheap, idempotent and
     * cached, and the page debounces it. The *indexer* search on the detail
     * page is the opposite and is a mutation for exactly that reason.
     */
    search: procedure
      .input(
        z.object({
          term: z.string().min(2),
          page: z.number().int().min(1).max(50).optional(),
        }),
      )
      .query(({ input }) =>
        upstream(async () => {
          const page = await searchMulti(tmdbConfig(), input.term, { page: input.page });

          // One query per kind for the whole page — not one per card.
          //
          // Series are matched on `arr_series.tmdb_id` alone. Sonarr's real key
          // is TVDb and TMDb does not carry it inline, so resolving it here
          // would be twenty extra TMDb calls per keystroke. The failure mode of
          // not doing so is a false *negative* — an Add button on something
          // already added — and the add path reports Sonarr's own "already
          // exists" as a success, so that costs a click and nothing else. A
          // false positive would hide a title with no recourse.
          const held = arrLibrary.annotateTmdbHits(page.results.map((r) => ({ tmdbId: r.id, mediaType: r.mediaType })));

          return {
            page: page.page,
            totalPages: page.totalPages,
            results: page.results.map((hit: TmdbSearchHit) => {
              const holding = held.get(discoverKey(hit.mediaType, hit.id)) ?? EMPTY_HOLDING;
              return {
                tmdbId: hit.id,
                mediaType: hit.mediaType,
                service: serviceFor(hit.mediaType),
                title: hit.title,
                year: hit.year ?? null,
                overview: hit.overview,
                posterPath: hit.posterPath,
                inArr: holding.arr,
                plexRatingKey: holding.plexRatingKey,
              };
            }),
          };
        }),
      ),

    /**
     * Send it for download.
     *
     * `service` is implied by `mediaType` rather than taken from the caller —
     * there is no such thing as adding a film to Sonarr, and an input that
     * lets you say so is an input somebody will eventually say it with.
     */
    add: procedure
      .input(
        z.object({
          mediaType: z.enum(["movie", "tv"]),
          tmdbId: z.number().int(),
          instanceId: z.string().optional(),
          qualityProfileId: z.number().int(),
          rootFolderPath: z.string(),
          monitor: z.boolean(),
          searchOnAdd: z.boolean(),
          minimumAvailability: z.enum(MINIMUM_AVAILABILITY).optional(),
          seriesMonitorMode: z.enum(SERIES_MONITOR_MODES).optional(),
          tags: z.array(z.number().int()).optional(),
        }),
      )
      .mutation(({ input }) =>
        upstream(async () => {
          const service = serviceFor(input.mediaType);
          const instance = requireInstance(service, input.instanceId);

          if (service === "radarr") {
            const radarr = radarrFor(instance);
            const candidates = await radarr.lookup(`tmdb:${input.tmdbId}`);
            // Match on the id, never take `[0]`. Radarr's lookup answers with
            // more than the exact hit, and adding the wrong film from a search
            // that looked right is the failure worth one line of defence.
            const candidate = candidates.find((c) => c.raw.tmdbId === input.tmdbId);
            if (!candidate) {
              throw new TRPCError({ code: "NOT_FOUND", message: `Radarr couldn't find TMDb id ${input.tmdbId}` });
            }
            const result = await radarr.addMovie(candidate, {
              qualityProfileId: input.qualityProfileId,
              rootFolderPath: input.rootFolderPath,
              monitor: input.monitor,
              searchOnAdd: input.searchOnAdd,
              minimumAvailability: input.minimumAvailability,
              tags: input.tags,
            });
            // Write the new record through so the "already added" badge is
            // right on the next render, rather than after the 00:30 sync.
            if (result.status === "added" && result.id !== undefined) {
              const added = await radarr.movie(result.id);
              if (added) arrLibrary.writeThroughMovie(instance.id, added);
            }
            return { ...result, service, instanceId: instance.id, instanceName: instance.name };
          }

          // Sonarr indexes on TVDb, and TMDb carries the mapping on a separate
          // endpoint. Paying for it once, at add time, beats twenty calls per
          // keystroke at search time.
          const ids = await fetchTvExternalIds(tmdbConfig(), input.tmdbId);
          if (!ids.tvdbId) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "TMDb has no TVDb id for this show, so Sonarr has no way to look it up.",
            });
          }
          const sonarr = sonarrFor(instance);
          const candidates = await sonarr.lookup(`tvdb:${ids.tvdbId}`);
          const candidate = candidates.find((c) => c.raw.tvdbId === ids.tvdbId);
          if (!candidate) {
            throw new TRPCError({ code: "NOT_FOUND", message: `Sonarr couldn't find TVDb id ${ids.tvdbId}` });
          }
          const result = await sonarr.addSeries(candidate, {
            qualityProfileId: input.qualityProfileId,
            rootFolderPath: input.rootFolderPath,
            monitor: input.monitor,
            searchOnAdd: input.searchOnAdd,
            monitorMode: input.seriesMonitorMode,
            tags: input.tags,
          });
          if (result.status === "added" && result.id !== undefined) {
            const added = await sonarr.series(result.id);
            if (added) arrLibrary.writeThroughSeries(instance.id, added);
          }
          return { ...result, service, instanceId: instance.id, instanceName: instance.name };
        }),
      ),
  });
}
