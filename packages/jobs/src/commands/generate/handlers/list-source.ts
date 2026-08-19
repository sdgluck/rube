import { type Services } from "@tinkerbell/composition";
import { createMdblistCommand } from "../sources/mdblist.ts";
import { createImdbCommand } from "../sources/imdb.ts";
import { createTraktCommand } from "../sources/trakt.ts";
import { indexItemsByImdb, indexItemsByTmdb, type IndexedItem } from "#commands/generate/plex-index.ts";

import type { HandlerDeps, PendingCollection } from "#commands/generate/types.ts";

interface ListResult {
  name: string;
  imdbIds: string[];
  tmdbIds: number[];
}

export function createListSourceCommand(deps: Services) {
  const { fetchMdbList } = createMdblistCommand(deps);
  const { fetchImdbList } = createImdbCommand(deps);
  const { fetchTraktList } = createTraktCommand(deps);

  /**
   * Fetch the source list. Each branch returns IMDb ids when it can; TMDb ids
   * are best-effort and only used when the IMDb match comes up empty.
   */
  async function fetchList(provider: string, listId: string, signal: AbortSignal | undefined): Promise<ListResult> {
    if (provider === "mdblist") return fetchMdbList(listId, signal);
    if (provider === "imdb") {
      const result = await fetchImdbList(listId);
      return { ...result, tmdbIds: [] };
    }
    if (provider === "trakt") return fetchTraktList(listId, signal);
    throw new Error(`Unknown list provider: ${provider}`);
  }

  /**
   * Generic "external list → one collection per section" handler. The list
   * source is selected per rule (`config.listProvider`), so adding a new
   * source is a matter of wiring it into `fetchList` above. Items are
   * matched to the local library by IMDb GUID first, falling back to TMDb
   * GUID — both indices are cheap to build and the IMDb-first ordering
   * matches the existing imdb-content handler.
   */
  const listSourceHandler = async function* (deps: HandlerDeps): AsyncGenerator<PendingCollection> {
    const { ctx, client, sections, ruleConfig } = deps;
    const provider = ruleConfig.listProvider;
    const listId = ruleConfig.listId;
    if (!provider) throw new Error("List provider is required.");
    if (!listId?.trim()) throw new Error("List id is required.");

    ctx.log(`Fetching ${provider} list "${listId}"...`);
    const { name: listName, imdbIds, tmdbIds } = await fetchList(provider, listId, ctx.signal);
    ctx.log(`Found ${imdbIds.length} IMDb id(s) and ${tmdbIds.length} TMDb id(s) in "${listName}".`);

    if (imdbIds.length === 0 && tmdbIds.length === 0) {
      ctx.log(`List "${listName}" has no usable ids — skipping.`);
      return;
    }

    const collectionName = ruleConfig.collectionName?.trim() || listName;

    for (const section of sections) {
      ctx.signal?.throwIfAborted();
      ctx.log(`[${listName}] "${section.title}" — matching against library...`);

      const matched: IndexedItem[] = [];
      const seen = new Set<string>();

      if (imdbIds.length > 0) {
        const { imdbToItem } = await indexItemsByImdb(client, section.key);
        for (const id of imdbIds) {
          const item = imdbToItem.get(id);
          if (item && !seen.has(item.ratingKey)) {
            matched.push(item);
            seen.add(item.ratingKey);
          }
        }
      }

      if (tmdbIds.length > 0) {
        const { tmdbToItem } = await indexItemsByTmdb(client, section.key);
        for (const id of tmdbIds) {
          const item = tmdbToItem.get(id);
          if (item && !seen.has(item.ratingKey)) {
            matched.push(item);
            seen.add(item.ratingKey);
          }
        }
      }

      if (matched.length === 0) {
        ctx.log(`No matching items in "${section.title}", skipping.`);
        continue;
      }

      yield { name: collectionName, section, matched };
    }
  };

  return { listSourceHandler };
}
