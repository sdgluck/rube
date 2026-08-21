import { perDeps } from "@tinkerbell/container";
import { type Services } from "@tinkerbell/composition";

/**
 * MDBList as the rules engine wants it: a name and two flat id arrays.
 *
 * The HTTP, the api key and the reference parsing all live in
 * `@tinkerbell/mdblist` — they moved there when Discover grew a list search
 * and `packages/trpc` needed the same three things. What stays here is the
 * shape `handlers/list-source.ts` matches against, which is deliberately
 * *not* the client's shape: downstream we match against the section's library
 * by GUID, so MDBList's movies/shows split is unimportant at this layer.
 */
export const createMdblistCommand = perDeps(function createMdblistCommand(deps: Pick<Services, "clients">) {
  const { getMdblistClient } = deps.clients;

  async function fetchMdbList(
    idOrSlug: string,
    signal?: AbortSignal,
  ): Promise<{ name: string; imdbIds: string[]; tmdbIds: number[] }> {
    const client = getMdblistClient();
    const [meta, items] = await Promise.all([
      client.getList(idOrSlug, signal),
      client.getListItems(idOrSlug, { signal }),
    ]);

    const imdbIds: string[] = [];
    const tmdbIds: number[] = [];
    for (const item of items) {
      if (item.imdbId) imdbIds.push(item.imdbId);
      if (item.tmdbId != null) tmdbIds.push(item.tmdbId);
    }

    return { name: meta?.name || idOrSlug, imdbIds, tmdbIds };
  }

  return { fetchMdbList };
});
