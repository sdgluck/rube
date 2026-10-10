/**
 * The library: served from the mirror for reads, proxied for writes.
 *
 * That split is the whole hybrid strategy in one file. A list is a local SQL
 * query because the *Arrs cannot page; a mutation goes straight upstream and
 * writes its result back into the mirror, because re-syncing ten thousand
 * movies to reflect one toggle would be absurd.
 */

import { z } from "zod";
import { ARR_SERVICES, MINIMUM_AVAILABILITY, SERIES_MONITOR_MODES } from "@tinkerbell/contracts";
import type { TrpcDeps } from "../deps.ts";
import { t, procedure } from "../_base.ts";
import { createArrClients, serviceInput, upstream } from "./_shared.ts";

const libraryQueryInput = z.object({
  service: z.enum(ARR_SERVICES),
  instanceId: z.string().optional(),
  search: z.string().optional(),
  monitored: z.boolean().optional(),
  hasFile: z.boolean().optional(),
  qualityProfileId: z.number().int().optional(),
  rootFolderPath: z.string().optional(),
  inPlex: z.boolean().optional(),
  sort: z.enum(["title", "year", "added", "size"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
});

export function createArrLibraryRouter(deps: Pick<TrpcDeps, "arr" | "arrLibrary">) {
  const { arr, arrLibrary } = deps;
  const { requireInstance, radarrFor, sonarrFor } = createArrClients(arr);

  return t.router({
    /** The unified list. No upstream call — this is why the mirror exists. */
    list: procedure.input(libraryQueryInput).query(({ input }) => arrLibrary.library(input)),

    get: procedure
      .input(z.object({ service: z.enum(ARR_SERVICES), instanceId: z.string(), arrId: z.number().int() }))
      .query(({ input }) =>
        input.service === "radarr"
          ? arrLibrary.movie(input.instanceId, input.arrId)
          : arrLibrary.series(input.instanceId, input.arrId),
      ),

    /**
     * Episodes for one series.
     *
     * Proxied, never mirrored — five hundred shows is fifty thousand episodes,
     * and this is one request for the one show somebody is looking at.
     */
    episodes: procedure
      .input(
        z.object({ instanceId: z.string(), seriesId: z.number().int(), seasonNumber: z.number().int().optional() }),
      )
      .query(({ input }) =>
        upstream(async () => {
          const instance = requireInstance("sonarr", input.instanceId);
          return sonarrFor(instance).episodes(input.seriesId, { seasonNumber: input.seasonNumber });
        }),
      ),

    /** Search the metadata provider for something to add. */
    lookup: procedure.input(serviceInput.extend({ term: z.string().min(1) })).query(({ input }) =>
      upstream(async () => {
        const instance = requireInstance(input.service, input.instanceId);
        return input.service === "radarr"
          ? radarrFor(instance).lookup(input.term)
          : sonarrFor(instance).lookup(input.term);
      }),
    ),

    add: procedure
      .input(
        serviceInput.extend({
          /** The looked-up candidate, verbatim — the add body is built from it. */
          candidate: z.record(z.string(), z.unknown()),
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
          const instance = requireInstance(input.service, input.instanceId);
          const candidate = { ...input.candidate, raw: input.candidate } as never;
          if (input.service === "radarr") {
            return radarrFor(instance).addMovie(candidate, {
              qualityProfileId: input.qualityProfileId,
              rootFolderPath: input.rootFolderPath,
              monitor: input.monitor,
              searchOnAdd: input.searchOnAdd,
              minimumAvailability: input.minimumAvailability,
              tags: input.tags,
            });
          }
          return sonarrFor(instance).addSeries(candidate, {
            qualityProfileId: input.qualityProfileId,
            rootFolderPath: input.rootFolderPath,
            monitor: input.monitor,
            searchOnAdd: input.searchOnAdd,
            monitorMode: input.seriesMonitorMode,
            tags: input.tags,
          });
        }),
      ),

    /**
     * Monitor or unmonitor one record.
     *
     * The client re-reads before writing — see `updateMovie`'s comment — so
     * this never hands it a mirror row. The mirror is updated *from the
     * response*, which is the freshest thing available.
     */
    setMonitored: procedure
      .input(
        z.object({
          service: z.enum(ARR_SERVICES),
          instanceId: z.string(),
          arrId: z.number().int(),
          monitored: z.boolean(),
        }),
      )
      .mutation(({ input }) =>
        upstream(async () => {
          const instance = requireInstance(input.service, input.instanceId);
          if (input.service === "radarr") {
            const updated = await radarrFor(instance).setMonitored(input.arrId, input.monitored);
            arrLibrary.writeThroughMovie(input.instanceId, updated);
            return { monitored: updated.monitored };
          }
          const updated = await sonarrFor(instance).setMonitored(input.arrId, input.monitored);
          arrLibrary.writeThroughSeries(input.instanceId, updated);
          return { monitored: updated.monitored };
        }),
      ),

    /** Sonarr only — a season has no id, so this is a whole-series PUT. */
    setSeasonMonitored: procedure
      .input(
        z.object({
          instanceId: z.string(),
          arrId: z.number().int(),
          seasonNumber: z.number().int(),
          monitored: z.boolean(),
        }),
      )
      .mutation(({ input }) =>
        upstream(async () => {
          const instance = requireInstance("sonarr", input.instanceId);
          const updated = await sonarrFor(instance).setSeasonMonitored(
            input.arrId,
            input.seasonNumber,
            input.monitored,
          );
          arrLibrary.writeThroughSeries(input.instanceId, updated);
          return { ok: true };
        }),
      ),

    /**
     * Bulk edit, grouped by instance.
     *
     * One `/editor` request per instance rather than N record PUTs: fewer
     * round trips, and the *Arr decides what "change these twelve" means
     * instead of us round-tripping twelve bodies, each a chance to clobber.
     */
    bulkEdit: procedure
      .input(
        z.object({
          service: z.enum(ARR_SERVICES),
          /** Records to change, named by the instance that holds them. */
          targets: z.array(z.object({ instanceId: z.string(), arrIds: z.array(z.number().int()).min(1) })).min(1),
          monitored: z.boolean().optional(),
          qualityProfileId: z.number().int().optional(),
          rootFolderPath: z.string().optional(),
          tags: z.array(z.number().int()).optional(),
          applyTags: z.enum(["add", "remove", "replace"]).optional(),
          moveFiles: z.boolean().optional(),
        }),
      )
      .mutation(({ input }) =>
        upstream(async () => {
          const results: Array<{ instanceId: string; updated: number; error?: string }> = [];
          for (const target of input.targets) {
            try {
              const instance = requireInstance(input.service, target.instanceId);
              const common = {
                monitored: input.monitored,
                qualityProfileId: input.qualityProfileId,
                rootFolderPath: input.rootFolderPath,
                tags: input.tags,
                applyTags: input.applyTags,
                moveFiles: input.moveFiles,
              };
              const updated =
                input.service === "radarr"
                  ? await radarrFor(instance).editor({ movieIds: target.arrIds, ...common })
                  : await sonarrFor(instance).editor({ seriesIds: target.arrIds, ...common });
              for (const row of updated) {
                if (input.service === "radarr") arrLibrary.writeThroughMovie(target.instanceId, row as never);
                else arrLibrary.writeThroughSeries(target.instanceId, row as never);
              }
              results.push({ instanceId: target.instanceId, updated: updated.length });
            } catch (err) {
              // One instance failing must not lose the others' results — the
              // caller needs to know exactly what did and did not happen.
              results.push({
                instanceId: target.instanceId,
                updated: 0,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          return { results };
        }),
      ),

    /**
     * Remove records. Destructive, and deliberately explicit about it.
     *
     * `deleteFiles` removes files from disk and `addImportExclusion` writes a
     * "never bring this back" entry, so neither has a default here — the
     * caller has to say.
     */
    remove: procedure
      .input(
        z.object({
          service: z.enum(ARR_SERVICES),
          targets: z.array(z.object({ instanceId: z.string(), arrIds: z.array(z.number().int()).min(1) })).min(1),
          deleteFiles: z.boolean(),
          addImportExclusion: z.boolean(),
        }),
      )
      .mutation(({ input }) =>
        upstream(async () => {
          const results: Array<{ instanceId: string; removed: number; error?: string }> = [];
          for (const target of input.targets) {
            try {
              const instance = requireInstance(input.service, target.instanceId);
              const opts = { deleteFiles: input.deleteFiles, addImportExclusion: input.addImportExclusion };
              if (input.service === "radarr") await radarrFor(instance).deleteMovies(target.arrIds, opts);
              else await sonarrFor(instance).deleteSeriesBulk(target.arrIds, opts);
              arrLibrary.markRemoved(input.service, target.instanceId, target.arrIds);
              results.push({ instanceId: target.instanceId, removed: target.arrIds.length });
            } catch (err) {
              results.push({
                instanceId: target.instanceId,
                removed: 0,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          return { results };
        }),
      ),

    /** Kick off a search. Returns a command id the caller can poll. */
    search: procedure
      .input(
        z.object({
          service: z.enum(ARR_SERVICES),
          instanceId: z.string(),
          arrId: z.number().int(),
          /** Sonarr only. Absent means the whole series. */
          seasonNumber: z.number().int().optional(),
        }),
      )
      .mutation(({ input }) =>
        upstream(async () => {
          const instance = requireInstance(input.service, input.instanceId);
          if (input.service === "radarr") return radarrFor(instance).search([input.arrId]);
          return input.seasonNumber === undefined
            ? sonarrFor(instance).searchSeries(input.arrId)
            : sonarrFor(instance).searchSeason(input.arrId, input.seasonNumber);
        }),
      ),

    refresh: procedure
      .input(z.object({ service: z.enum(ARR_SERVICES), instanceId: z.string(), arrId: z.number().int() }))
      .mutation(({ input }) =>
        upstream(async () => {
          const instance = requireInstance(input.service, input.instanceId);
          return input.service === "radarr"
            ? radarrFor(instance).refresh(input.arrId)
            : sonarrFor(instance).refresh(input.arrId);
        }),
      ),

    /**
     * Per-instance counts and health, from `arr_sync_state`.
     *
     * Read from the mirror rather than fanned out to each *Arr, so an
     * unreachable instance renders as one bad card instead of hanging the page.
     */
    instanceState: procedure
      .input(z.object({ instanceIds: z.array(z.string()).optional() }).optional())
      .query(({ input }) => arrLibrary.instanceState(input?.instanceIds)),
  });
}
