import { z } from "zod";
import { reportHealth } from "./health.ts";
import { errorMessage } from "./util.ts";

const itemListBlockSchema = z.object({
  itemListElement: z
    .array(
      z.object({
        url: z.string().optional(),
        item: z.object({ url: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  name: z.string().optional(),
});

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
    const parsed = itemListBlockSchema.safeParse(block);
    if (!parsed.success) continue;
    for (const el of parsed.data.itemListElement ?? []) {
      const url = el.item?.url ?? el.url ?? "";
      const idMatch = url.match(/\/title\/(tt\d+)/);
      if (idMatch) ids.push(idMatch[1]);
    }
  }
  return ids;
}

export async function fetchImdbChart(chartId: string): Promise<{ name: string; imdbIds: string[] }> {
  const chart = IMDB_CHARTS[chartId];
  if (!chart) throw new Error(`Unknown IMDb chart: ${chartId}`);

  let res: Response;
  try {
    res = await fetch(`https://www.imdb.com${chart.path}`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
    });
  } catch (err) {
    reportHealth("IMDb", "error", `GET ${chart.path} → ${errorMessage(err)}`);
    throw err;
  }
  if (!res.ok) {
    reportHealth("IMDb", "error", `GET ${chart.path} → ${res.status}`);
    throw new Error(`Failed to fetch IMDb chart ${chartId}: ${res.status}`);
  }
  reportHealth("IMDb", "ok", `GET ${chart.path} → ${res.status}`);

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

  let res: Response;
  try {
    res = await fetch(`https://www.imdb.com/list/${listId}/`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
    });
  } catch (err) {
    reportHealth("IMDb", "error", `GET /list/${listId} → ${errorMessage(err)}`);
    throw err;
  }
  if (!res.ok) {
    reportHealth("IMDb", "error", `GET /list/${listId} → ${res.status}`);
    throw new Error(`Failed to fetch IMDb list ${listId}: ${res.status}`);
  }
  reportHealth("IMDb", "ok", `GET /list/${listId} → ${res.status}`);

  const html = await res.text();
  const jsonLd = extractJsonLd(html);
  const imdbIds = extractImdbIdsFromItemList(jsonLd);

  // Extract list title from JSON-LD or <title> tag
  let title = listId;
  for (const block of jsonLd) {
    const parsed = itemListBlockSchema.safeParse(block);
    if (parsed.success && parsed.data.name) {
      title = parsed.data.name;
      break;
    }
  }

  if (imdbIds.length === 0) {
    throw new Error(`No IMDb IDs found in list ${listId}. The list may be empty or the page structure changed.`);
  }

  return { title, imdbIds };
}
