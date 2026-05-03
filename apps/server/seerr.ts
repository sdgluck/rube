export interface SeerrRequest {
  id: number;
  media: {
    tmdbId: number;
    mediaType: "movie" | "tv";
    status: number;
  };
  requestedBy: {
    username: string;
  };
  createdAt: string;
}

interface SeerrPageInfo {
  pages: number;
  pageSize: number;
  results: number;
  page: number;
}

interface SeerrRequestResponse {
  pageInfo: SeerrPageInfo;
  results: SeerrRequest[];
}

export async function fetchSeerrRequests(opts: {
  url: string;
  apiKey: string;
  filter?: string;
  limit?: number;
}): Promise<SeerrRequest[]> {
  const { limit = 50 } = opts;
  const all: SeerrRequest[] = [];
  for await (const req of iterSeerrRequests(opts)) {
    all.push(req);
    if (all.length >= limit) break;
  }
  return all;
}

/**
 * Yield Seerr requests page-by-page so the caller can stop as soon as it has
 * accumulated enough matched items. Used by the seerr_requests rule so the
 * resulting collection can be filled up to the user's `limit` even when many
 * requested items aren't present in the matched Plex section.
 */
export async function* iterSeerrRequests(opts: {
  url: string;
  apiKey: string;
  filter?: string;
}): AsyncGenerator<SeerrRequest, void, unknown> {
  const { url, apiKey, filter } = opts;
  const take = 20;
  let skip = 0;

  while (true) {
    const reqUrl = new URL("/api/v1/request", url);
    reqUrl.searchParams.set("take", String(take));
    reqUrl.searchParams.set("skip", String(skip));
    if (filter && filter !== "all") {
      reqUrl.searchParams.set("filter", filter);
    }

    const res = await fetch(reqUrl.toString(), {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Seerr API error: ${res.status} ${res.statusText}`);

    const data: SeerrRequestResponse = await res.json();
    for (const r of data.results) yield r;

    skip += take;
    if (skip >= data.pageInfo.results) return;
    if (data.results.length === 0) return;
  }
}

export async function testSeerrConnection(
  url: string,
  apiKey: string,
): Promise<{ total: number; movie: number; tv: number }> {
  const reqUrl = new URL("/api/v1/request/count", url);
  const res = await fetch(reqUrl.toString(), {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Seerr API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return { total: data.total ?? 0, movie: data.movie ?? 0, tv: data.tv ?? 0 };
}
