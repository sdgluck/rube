import { getConfig } from "@tinkerbell/core";
import { httpRequestJson } from "@tinkerbell/http";

/**
 * MDBList is a third-party service on the far side of the internet. This used
 * to be a bare `fetch(url, { signal })` where `signal` was only the job's own
 * abort signal — nothing fired it on its own, so a hung socket meant the run
 * sat in `running` forever, which blocked the whole queue behind it.
 */
const MDBLIST_TIMEOUT_MS = 20_000;

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
  const data = await httpRequestJson<MdbListResponse>({
    url,
    init: { signal },
    timeoutMs: MDBLIST_TIMEOUT_MS,
    // Idempotent GET — retrying a transient 502 beats failing the nightly run.
    retries: 2,
  });
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
