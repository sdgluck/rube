import { perDeps } from "@tinkerbell/container";
import { type Services } from "@tinkerbell/composition";

/**
 * Trakt as the rules engine wants it: a name and two flat id arrays.
 *
 * The HTTP, the client id, the reference parsing and the "this list isn't
 * public" error mapping all live in `@tinkerbell/trakt` — they moved there
 * when Discover grew a list search and `packages/trpc` needed the same four
 * things. Read that file's header for the public-lists-only scope note.
 */
export const createTraktCommand = perDeps(function createTraktCommand(deps: Pick<Services, "clients">) {
  const { getTraktClient } = deps.clients;

  async function fetchTraktList(
    reference: string,
    signal?: AbortSignal,
  ): Promise<{ name: string; imdbIds: string[]; tmdbIds: number[] }> {
    const client = getTraktClient();
    // Metadata first: it is the request that distinguishes a private list from
    // a bad key, and getting that message out before paging through items is
    // the difference between one useful error and a confusing empty result.
    const meta = await client.getList(reference, signal);
    const items = await client.getListItems(reference, { signal });

    const imdbIds: string[] = [];
    const tmdbIds: number[] = [];
    for (const item of items) {
      if (item.imdbId) imdbIds.push(item.imdbId);
      if (item.tmdbId != null) tmdbIds.push(item.tmdbId);
    }

    return { name: meta.name || reference, imdbIds, tmdbIds };
  }

  return { fetchTraktList };
});
