const IMDB_CHARTS: Record<string, { name: string; path: string }> = {
  top_250_movies: { name: "IMDb Top 250 Movies", path: "/chart/top/" },
  top_250_tv: { name: "IMDb Top 250 TV Shows", path: "/chart/toptv/" },
  popular_movies: { name: "Most Popular Movies", path: "/chart/moviemeter/" },
  popular_tv: { name: "Most Popular TV Shows", path: "/chart/tvmeter/" },
  box_office: { name: "Box Office", path: "/chart/boxoffice/" },
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function extractJsonLd(html: string): unknown[] {
  const results: unknown[] = [];
  const regex = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      results.push(JSON.parse(match[1]));
    } catch {
      // skip malformed JSON-LD blocks
    }
  }
  return results;
}

function extractImdbIdsFromItemList(jsonLd: unknown[]): string[] {
  const ids: string[] = [];
  for (const block of jsonLd) {
    if (typeof block !== "object" || block === null) continue;
    const obj = block as Record<string, unknown>;
    const elements = obj.itemListElement as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(elements)) continue;

    for (const el of elements) {
      const item = el.item as Record<string, unknown> | undefined;
      const url = (item?.url as string) || (el.url as string) || "";
      const idMatch = url.match(/\/title\/(tt\d+)/);
      if (idMatch) ids.push(idMatch[1]);
    }
  }
  return ids;
}

export async function fetchImdbChart(chartId: string): Promise<{ name: string; imdbIds: string[] }> {
  const chart = IMDB_CHARTS[chartId];
  if (!chart) throw new Error(`Unknown IMDb chart: ${chartId}`);

  const res = await fetch(`https://www.imdb.com${chart.path}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`Failed to fetch IMDb chart ${chartId}: ${res.status}`);

  const html = await res.text();
  const jsonLd = extractJsonLd(html);
  const imdbIds = extractImdbIdsFromItemList(jsonLd);

  if (imdbIds.length === 0) {
    throw new Error(`No IMDb IDs found in chart ${chartId}. The page structure may have changed.`);
  }

  return { name: chart.name, imdbIds };
}

export async function fetchImdbList(listIdOrUrl: string): Promise<{ title: string; imdbIds: string[] }> {
  // Normalize: accept full URL or just the list ID
  let listId = listIdOrUrl.trim();
  const urlMatch = listId.match(/\/list\/(ls\d+)/);
  if (urlMatch) listId = urlMatch[1];
  if (!listId.match(/^ls\d+$/)) {
    throw new Error(`Invalid IMDb list ID: "${listIdOrUrl}". Expected format: ls123456789`);
  }

  const res = await fetch(`https://www.imdb.com/list/${listId}/`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`Failed to fetch IMDb list ${listId}: ${res.status}`);

  const html = await res.text();
  const jsonLd = extractJsonLd(html);
  const imdbIds = extractImdbIdsFromItemList(jsonLd);

  // Extract list title from JSON-LD or <title> tag
  let title = listId;
  for (const block of jsonLd) {
    if (typeof block === "object" && block !== null) {
      const name = (block as Record<string, unknown>).name as string | undefined;
      if (name) {
        title = name;
        break;
      }
    }
  }

  if (imdbIds.length === 0) {
    throw new Error(`No IMDb IDs found in list ${listId}. The list may be empty or the page structure changed.`);
  }

  return { title, imdbIds };
}
