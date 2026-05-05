import { getConfig } from "@tinkerbell/core";

interface MdbListItem {
  imdb_id?: string | null;
  tmdb_id?: number | null;
}

interface MdbListResponse {
  /** Returned as a sibling array on the items endpoint. */
  movies?: MdbListItem[];
  shows?: MdbListItem[];
  /** List metadata when calling /lists/{id} */
  name?: string;
  error?: string;
}

/**
 * Resolve an MDBList list reference to its API path. Accepts either a
 * numeric list id (`12345`) or a `username/listname` slug (the share-URL
 * form). Each path segment is URL-encoded individually so a list name
 * containing spaces, `?`, `#`, or `&` can't break out into the query
 * string and inject parameters into the upstream request.
 */
function listPath(idOrSlug: string): string {
  const trimmed = idOrSlug.trim();
  if (/^\d+$/.test(trimmed)) return `/lists/${encodeURIComponent(trimmed)}`;
  // Strip a leading https://mdblist.com/lists/ if a user pasted a URL.
  const slug = trimmed.replace(/^https?:\/\/(www\.)?mdblist\.com\/lists\//i, "").replace(/\/+$/, "");
  // Encode each segment independently so the `/` separator survives but
  // unsafe characters in the segments don't.
  const encoded = slug.split("/").map(encodeURIComponent).join("/");
  return `/lists/${encoded}`;
}

async function mdblistFetch(path: string, signal?: AbortSignal): Promise<MdbListResponse> {
  const apiKey = getConfig("global_mdblist_api_key");
  if (!apiKey) throw new Error("MDBList API key is not configured (Settings → Databases).");
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.mdblist.com${path}${sep}apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`MDBList ${res.status} ${res.statusText}`);
  const data = (await res.json()) as MdbListResponse;
  if (data.error) throw new Error(`MDBList: ${data.error}`);
  return data;
}

/**
 * Fetch list metadata (name) and items (IMDb + TMDb ids). Items are
 * returned as a flat array — MDBList separates `movies` and `shows` server
 * side, but downstream we just match against the section's library so the
 * split is unimportant here.
 */
export async function fetchMdbList(
  idOrSlug: string,
  signal?: AbortSignal,
): Promise<{ name: string; imdbIds: string[]; tmdbIds: number[] }> {
  const base = listPath(idOrSlug);
  const [meta, items] = await Promise.all([mdblistFetch(base, signal), mdblistFetch(`${base}/items`, signal)]);

  const all = [...(items.movies ?? []), ...(items.shows ?? [])];
  const imdbIds: string[] = [];
  const tmdbIds: number[] = [];
  for (const item of all) {
    if (item.imdb_id) imdbIds.push(item.imdb_id);
    if (typeof item.tmdb_id === "number") tmdbIds.push(item.tmdb_id);
  }

  return { name: meta.name?.trim() || idOrSlug, imdbIds, tmdbIds };
}
