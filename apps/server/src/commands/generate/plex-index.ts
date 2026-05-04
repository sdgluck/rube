import type { PlexClient } from "@tinkerbell/plex";

export interface IndexedItem {
  ratingKey: string;
  title: string;
  year?: number;
}

/**
 * Fetch a section's items + GUIDs and index by IMDb ID. The first IMDb GUID
 * on each item wins — Plex sometimes lists multiple, but we only need a
 * single canonical mapping.
 */
export async function indexItemsByImdb(
  client: PlexClient,
  sectionKey: string,
): Promise<{ items: Awaited<ReturnType<PlexClient["allItemsWithGuids"]>>; imdbToItem: Map<string, IndexedItem> }> {
  const items = await client.allItemsWithGuids(sectionKey);
  const imdbToItem = new Map<string, IndexedItem>();
  for (const item of items) {
    for (const guid of item.guids) {
      const m = guid.match(/imdb:\/\/(tt\d+)/);
      if (m) {
        imdbToItem.set(m[1], { ratingKey: item.ratingKey, title: item.title, year: item.year });
        break;
      }
    }
  }
  return { items, imdbToItem };
}

export async function indexItemsByTmdb(
  client: PlexClient,
  sectionKey: string,
): Promise<{ items: Awaited<ReturnType<PlexClient["allItemsWithGuids"]>>; tmdbToItem: Map<number, IndexedItem> }> {
  const items = await client.allItemsWithGuids(sectionKey);
  const tmdbToItem = new Map<number, IndexedItem>();
  for (const item of items) {
    for (const guid of item.guids) {
      const m = guid.match(/tmdb:\/\/(\d+)/);
      if (m) {
        tmdbToItem.set(parseInt(m[1], 10), { ratingKey: item.ratingKey, title: item.title, year: item.year });
        break;
      }
    }
  }
  return { items, tmdbToItem };
}
