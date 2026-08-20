/**
 * Queue, history, releases, calendar, wanted, blocklist.
 *
 * Almost entirely live proxy. Nothing here is served from a mirror, because a
 * stored download queue is worse than no queue: it looks authoritative and is
 * wrong within seconds. The exception is the timeline, which reads the
 * `arr_activity` ledger — that is an immutable event log, not a state snapshot.
 */

import { z } from "zod";
import { ARR_SERVICES } from "@tinkerbell/contracts";
import type { TrpcDeps } from "../deps.ts";
import { t, procedure } from "../_base.ts";
import { createArrClients, upstream } from "./_shared.ts";

const pageInput = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
  sortKey: z.string().optional(),
  sortDirection: z.enum(["ascending", "descending"]).optional(),
});

const targetInput = z.object({
  service: z.enum(ARR_SERVICES),
  instanceId: z.string(),
});

export function createArrActivityRouter(deps: Pick<TrpcDeps, "arr" | "arrActivity">) {
  const { arr, arrActivity } = deps;
  const { requireInstance, radarrFor, sonarrFor } = createArrClients(arr);

  const clientFor = (service: "radarr" | "sonarr", instanceId?: string) => {
    const instance = requireInstance(service, instanceId);
    return service === "radarr" ? radarrFor(instance) : sonarrFor(instance);
  };

  return t.router({
    queue: procedure
      .input(targetInput.merge(pageInput))
      .query(({ input }) => upstream(() => clientFor(input.service, input.instanceId).queue(input))),

    /** Counts only — what a nav badge needs, without the records. */
    queueStatus: procedure
      .input(targetInput)
      .query(({ input }) => upstream(() => clientFor(input.service, input.instanceId).queueStatus())),

    removeFromQueue: procedure
      .input(
        targetInput.extend({
          ids: z.array(z.number().int()).min(1),
          removeFromClient: z.boolean().optional(),
          blocklist: z.boolean().optional(),
          skipRedownload: z.boolean().optional(),
        }),
      )
      .mutation(({ input }) =>
        upstream(async () => {
          const client = clientFor(input.service, input.instanceId);
          const opts = {
            removeFromClient: input.removeFromClient,
            blocklist: input.blocklist,
            skipRedownload: input.skipRedownload,
          };
          if (input.ids.length === 1) await client.removeFromQueue(input.ids[0], opts);
          else await client.removeFromQueueBulk(input.ids, opts);
          return { removed: input.ids.length };
        }),
      ),

    history: procedure
      .input(targetInput.merge(pageInput))
      .query(({ input }) => upstream(() => clientFor(input.service, input.instanceId).history(input))),

    markHistoryFailed: procedure.input(targetInput.extend({ historyId: z.number().int() })).mutation(({ input }) =>
      upstream(async () => {
        await clientFor(input.service, input.instanceId).markHistoryFailed(input.historyId);
        return { ok: true };
      }),
    ),

    /**
     * Interactive search.
     *
     * Slow by nature — it hits every configured indexer and routinely takes
     * over a minute — so it is a mutation rather than a query. That keeps
     * TanStack Query from ever firing it on mount, refetch or window focus,
     * which is the behaviour that would get somebody rate-limited.
     */
    releases: procedure
      .input(
        targetInput.extend({
          arrId: z.number().int(),
          seasonNumber: z.number().int().optional(),
          episodeId: z.number().int().optional(),
        }),
      )
      .mutation(({ input }) =>
        upstream(async () => {
          const instance = requireInstance(input.service, input.instanceId);
          if (input.service === "radarr") return radarrFor(instance).releases(input.arrId);
          return sonarrFor(instance).releases({
            seriesId: input.arrId,
            seasonNumber: input.seasonNumber,
            episodeId: input.episodeId,
          });
        }),
      ),

    grabRelease: procedure
      .input(targetInput.extend({ release: z.record(z.string(), z.unknown()) }))
      .mutation(({ input }) =>
        upstream(async () => {
          await clientFor(input.service, input.instanceId).grabRelease(input.release as never);
          return { ok: true };
        }),
      ),

    /**
     * The calendar — **movies from Radarr, episodes from Sonarr**.
     *
     * Tagged with the service rather than flattened into a common row type. A
     * movie is its own release date; a series has none, only its episodes do.
     * There is no honest shared shape, and inventing one would mean the
     * renderer re-deriving which it actually got from whichever fields
     * happened to be present.
     */
    calendar: procedure
      .input(targetInput.extend({ start: z.string(), end: z.string(), unmonitored: z.boolean().optional() }))
      .query(({ input }) =>
        upstream(async () => {
          const instance = requireInstance(input.service, input.instanceId);
          const range = [new Date(input.start), new Date(input.end)] as const;
          const opts = { unmonitored: input.unmonitored };
          if (input.service === "radarr") {
            return { service: "radarr" as const, movies: await radarrFor(instance).calendar(...range, opts) };
          }
          return { service: "sonarr" as const, episodes: await sonarrFor(instance).calendar(...range, opts) };
        }),
      ),

    /**
     * Wanted — again movies from Radarr, episodes from Sonarr.
     *
     * A series-level answer would be meaningless: almost every continuing show
     * is missing its next episode.
     */
    wanted: procedure
      .input(targetInput.merge(pageInput).extend({ kind: z.enum(["missing", "cutoff"]).default("missing") }))
      .query(({ input }) =>
        upstream(async () => {
          const instance = requireInstance(input.service, input.instanceId);
          if (input.service === "radarr") {
            const client = radarrFor(instance);
            const page =
              input.kind === "missing" ? await client.wantedMissing(input) : await client.wantedCutoff(input);
            return { service: "radarr" as const, page };
          }
          const client = sonarrFor(instance);
          const page = input.kind === "missing" ? await client.wantedMissing(input) : await client.wantedCutoff(input);
          return { service: "sonarr" as const, page };
        }),
      ),

    blocklist: procedure
      .input(targetInput.merge(pageInput))
      .query(({ input }) => upstream(() => clientFor(input.service, input.instanceId).blocklist(input))),

    removeFromBlocklist: procedure
      .input(targetInput.extend({ ids: z.array(z.number().int()).min(1) }))
      .mutation(({ input }) =>
        upstream(async () => {
          const client = clientFor(input.service, input.instanceId);
          if (input.ids.length === 1) await client.removeFromBlocklist(input.ids[0]);
          else await client.removeFromBlocklistBulk(input.ids);
          return { removed: input.ids.length };
        }),
      ),

    /** Poll a running command — search, refresh, rescan. */
    commandStatus: procedure
      .input(targetInput.extend({ commandId: z.number().int() }))
      .query(({ input }) =>
        upstream(() => clientFor(input.service, input.instanceId).commands.status(input.commandId)),
      ),

    // ── The ledger ──────────────────────────────────────────────────────

    /** One item's history, from `arr_activity`. */
    timeline: procedure
      .input(z.object({ instanceId: z.string(), arrId: z.number().int() }))
      .query(({ input }) => arrActivity.forItem(input.instanceId, input.arrId)),

    /** Everything sharing a download id — the grab, the import, the failure. */
    forDownload: procedure
      .input(z.object({ downloadId: z.string().min(1) }))
      .query(({ input }) => arrActivity.forDownload(input.downloadId)),

    recent: procedure
      .input(
        z
          .object({
            instanceIds: z.array(z.string()).optional(),
            eventTypes: z.array(z.string()).optional(),
            limit: z.number().int().min(1).max(500).optional(),
          })
          .optional(),
      )
      .query(({ input }) => arrActivity.recent(input ?? {})),
  });
}
