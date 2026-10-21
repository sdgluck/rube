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
import { searchMulti, fetchTvExternalIds, type TmdbSearchHit } from "@rube/tmdb";
import { MINIMUM_AVAILABILITY, SERIES_MONITOR_MODES, type ArrService } from "@rube/contracts";
import { discoverKey, type DiscoverHolding, type ExternalKey } from "@rube/domain.arr-library";
import type { TrpcDeps } from "./deps.ts";
import { t, procedure } from "./_base.ts";
import { createArrClients, upstream } from "./arr/_shared.ts";

/** Movies go to Radarr, shows go to Sonarr. There is no third answer. */
function serviceFor(mediaType: "movie" | "tv"): ArrService {
  return mediaType === "movie" ? "radarr" : "sonarr";
}

const EMPTY_HOLDING: DiscoverHolding = { arr: [], plexRatingKey: null };

/**
 * The providers whose lists can be *searched*.
 *
 * Not the same set as `listProvider` in contracts, which also carries `imdb`.
 * MDBList and Trakt expose a list-search endpoint; IMDb and TMDb do not — TMDb
 * lists are fetch-by-id only in both v3 and v4, and IMDb has no list search at
 * all since the site dropped it. Those two therefore stay a paste-in on the
 * rule wizard, and this list is what the UI must say it covers rather than
 * implying it searches everywhere.
 */
export const LIST_SEARCH_PROVIDERS = ["mdblist", "trakt"] as const;
export type ListSearchProvider = (typeof LIST_SEARCH_PROVIDERS)[number];

/** One list, as every provider is flattened into before it reaches the browser. */
export interface ListHit {
  provider: ListSearchProvider;
  /** The numeric id, always — a slug follows a rename and the rule would stop resolving. */
  listId: string;
  name: string;
  owner: string;
  description: string;
  itemCount: number;
  likes: number;
}

/** Providers speak `show`; the rest of Discover speaks `tv`. */
function toMediaType(raw: string): "movie" | "tv" {
  return raw === "movie" ? "movie" : "tv";
}

export function createDiscoverRouter(deps: Pick<TrpcDeps, "arr" | "arrLibrary" | "clients" | "config">) {
  const { arr, arrLibrary, clients, config } = deps;
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

  /** One screenful. See `lists.preview` for why it is capped at all. */
  const PREVIEW_LIMIT = 100;

  function mdblist() {
    if (!config.getConfig("global_mdblist_api_key")) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "MDBList is not configured" });
    }
    return clients.getMdblistClient();
  }

  function trakt() {
    if (!config.getConfig("global_trakt_client_id")) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Trakt is not configured" });
    }
    return clients.getTraktClient();
  }

  function configured(provider: ListSearchProvider): boolean {
    return provider === "mdblist"
      ? !!config.getConfig("global_mdblist_api_key")
      : !!config.getConfig("global_trakt_client_id");
  }

  /**
   * Fan one question out over every configured provider.
   *
   * Sorted by likes because the merged result has no cross-provider relevance
   * score to sort by — MDBList's ordering and Trakt's are each meaningful only
   * within themselves, and interleaving them by popularity is the one ordering
   * that means the same thing on both sides.
   */
  async function searchProviders(
    run: (provider: ListSearchProvider) => Promise<ListHit[]>,
  ): Promise<{ results: ListHit[]; failed: ListSearchProvider[]; unconfigured: ListSearchProvider[] }> {
    const active = LIST_SEARCH_PROVIDERS.filter(configured);
    const settled = await Promise.allSettled(active.map(run));

    const results: ListHit[] = [];
    const failed: ListSearchProvider[] = [];
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "fulfilled") results.push(...outcome.value);
      else failed.push(active[index]!);
    }

    results.sort((a, b) => b.likes - a.likes);
    return { results, failed, unconfigured: LIST_SEARCH_PROVIDERS.filter((p) => !configured(p)) };
  }

  async function searchOne(provider: ListSearchProvider, term: string, signal?: AbortSignal): Promise<ListHit[]> {
    if (provider === "mdblist") {
      const hits = await mdblist().searchLists(term, signal);
      return hits.map((l) => ({
        provider,
        listId: String(l.id),
        name: l.name,
        owner: l.owner,
        description: l.description,
        itemCount: l.itemCount,
        likes: l.likes,
      }));
    }
    const hits = await trakt().searchLists(term, signal);
    return hits.map((l) => ({
      provider,
      listId: String(l.id),
      name: l.name,
      owner: l.owner,
      description: l.description,
      itemCount: l.itemCount,
      likes: l.likes,
    }));
  }

  async function topOne(provider: ListSearchProvider, signal?: AbortSignal): Promise<ListHit[]> {
    if (provider === "mdblist") {
      const hits = await mdblist().topLists(signal);
      return hits.map((l) => ({
        provider,
        listId: String(l.id),
        name: l.name,
        owner: l.owner,
        description: l.description,
        itemCount: l.itemCount,
        likes: l.likes,
      }));
    }
    const hits = await trakt().trendingLists(signal);
    return hits.map((l) => ({
      provider,
      listId: String(l.id),
      name: l.name,
      owner: l.owner,
      description: l.description,
      itemCount: l.itemCount,
      likes: l.likes,
    }));
  }

  async function previewItems(
    provider: ListSearchProvider,
    listId: string,
    signal?: AbortSignal,
  ): Promise<{
    name: string;
    items: { title: string; year: number | null; mediaType: string; imdbId: string | null; tmdbId: number | null }[];
  }> {
    if (provider === "mdblist") {
      const client = mdblist();
      const [meta, items] = await Promise.all([
        client.getList(listId, signal),
        client.getListItems(listId, { limit: PREVIEW_LIMIT, signal }),
      ]);
      return { name: meta?.name || listId, items };
    }
    const client = trakt();
    // Metadata first: it is the request that distinguishes a private list from
    // a bad key, and that message is worth getting out before paging items.
    const meta = await client.getList(listId, signal);
    const items = await client.getListItems(listId, { limit: PREVIEW_LIMIT, signal });
    return { name: meta.name || listId, items };
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
      // The keys themselves are in `SECRET_KEYS`; only whether they exist
      // crosses the wire, which is all the tab needs to render.
      mdblist: !!config.getConfig("global_mdblist_api_key"),
      trakt: !!config.getConfig("global_trakt_client_id"),
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
     * Curated lists, searched across the providers that can be searched.
     *
     * A sub-router rather than three more top-level procedures because
     * `discover.lists.search` and `discover.search` are different questions
     * about different objects, and flattening them into `searchLists` next to
     * `search` reads like a variant of the same call.
     */
    lists: t.router({
      /**
       * Search every configured provider at once.
       *
       * `allSettled`, not `all`: MDBList being down should cost you MDBList's
       * results, not the whole tab. What failed is reported rather than
       * swallowed, so an empty result never quietly means "one of these is
       * broken".
       */
      search: procedure
        .input(z.object({ term: z.string().min(2) }))
        .query(({ input, signal }) => searchProviders((p) => searchOne(p, input.term, signal))),

      /**
       * What to show before anyone types.
       *
       * A search box over an unfamiliar corpus is a worse blank page than a
       * shelf of popular lists, and both providers hand this back for free.
       */
      top: procedure.query(({ signal }) => searchProviders((p) => topOne(p, signal))),

      /**
       * What is in a list, and how much of it you already hold.
       *
       * Capped at `PREVIEW_LIMIT` on purpose: this answers "is this the list I
       * think it is, and is it worth a rule?", and nobody reads item 400. The
       * rule itself fetches the whole thing when it runs.
       *
       * Rendered as text rows rather than posters because neither provider
       * returns poster art dependably, and backfilling it would be a hundred
       * TMDb calls every time somebody opened the panel.
       */
      preview: procedure
        .input(
          z.object({
            provider: z.enum(LIST_SEARCH_PROVIDERS),
            listId: z.string().min(1),
          }),
        )
        .query(({ input, signal }) =>
          upstream(async () => {
            const { name, items } = await previewItems(input.provider, input.listId, signal);

            // Keyed on position, not on an id: an entry carrying only an IMDb
            // id has no id pair to key on, and two entries can name the same
            // title.
            const keys: ExternalKey[] = items.flatMap((item, index) =>
              item.tmdbId == null && !item.imdbId
                ? []
                : [
                    {
                      key: String(index),
                      mediaType: toMediaType(item.mediaType),
                      tmdbId: item.tmdbId,
                      imdbId: item.imdbId,
                    },
                  ],
            );
            const held = arrLibrary.annotateExternalHits(keys);

            return {
              name,
              truncated: items.length >= PREVIEW_LIMIT,
              items: items.map((item, index) => {
                const holding = held.get(String(index)) ?? EMPTY_HOLDING;
                const mediaType = toMediaType(item.mediaType);
                return {
                  title: item.title,
                  year: item.year,
                  mediaType,
                  service: serviceFor(mediaType),
                  tmdbId: item.tmdbId,
                  imdbId: item.imdbId,
                  inArr: holding.arr,
                  plexRatingKey: holding.plexRatingKey,
                };
              }),
            };
          }),
        ),
    }),

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
