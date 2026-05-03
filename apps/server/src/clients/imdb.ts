import { z } from "zod";
import { reportHealth } from "../domains/health.ts";
import { errorMessage } from "../lib/util.ts";

/**
 * IMDb chart and list fetching, via the public (anonymous, undocumented)
 * GraphQL endpoint that powers IMDb's own SPA. The HTML pages at imdb.com are
 * gated by an AWS WAF JS challenge; the GraphQL endpoint is not, returns clean
 * JSON, and is what the rest of the IMDb-tooling ecosystem (Cinemeta etc.)
 * relies on.
 */

const GRAPHQL_URL = "https://caching.graphql.imdb.com/";
const REQUEST_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "x-imdb-client-name": "imdb-web-next-localized",
  "x-imdb-user-language": "en-US",
  "x-imdb-user-country": "US",
};

interface ChartConfig {
  name: string;
  // GraphQL ChartTitleType enum value, or "BOX_OFFICE" for the special box-office query.
  chartType: string;
  size: number;
}

const IMDB_CHARTS: Record<string, ChartConfig> = {
  top_250_movies: { name: "IMDb Top 250 Movies", chartType: "TOP_RATED_MOVIES", size: 250 },
  top_250_tv: { name: "IMDb Top 250 TV Shows", chartType: "TOP_RATED_TV_SHOWS", size: 250 },
  popular_movies: { name: "Most Popular Movies", chartType: "MOST_POPULAR_MOVIES", size: 100 },
  popular_tv: { name: "Most Popular TV Shows", chartType: "MOST_POPULAR_TV_SHOWS", size: 100 },
  box_office: { name: "Box Office", chartType: "BOX_OFFICE", size: 10 },
};

// ─── Response schemas ────────────────────────────────────────────────────

const titleNodeSchema = z
  .object({
    id: z.string(),
    titleText: z.object({ text: z.string().optional() }).optional(),
  })
  .passthrough();

const chartTitlesResponseSchema = z.object({
  data: z
    .object({
      chartTitles: z
        .object({
          edges: z.array(z.object({ node: titleNodeSchema })),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const boxOfficeResponseSchema = z.object({
  data: z
    .object({
      boxOfficeWeekendChart: z
        .object({
          entries: z.array(z.object({ title: titleNodeSchema })),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const listResponseSchema = z.object({
  data: z
    .object({
      list: z
        .object({
          name: z.object({ originalText: z.string().optional() }).nullable().optional(),
          items: z.object({
            pageInfo: z.object({
              hasNextPage: z.boolean(),
              endCursor: z.string().nullable().optional(),
            }),
            edges: z.array(
              z.object({
                node: z.object({
                  item: titleNodeSchema.partial().passthrough(),
                }),
              }),
            ),
          }),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

// ─── Core request ────────────────────────────────────────────────────────

async function graphql(label: string, body: { query: string; variables?: Record<string, unknown> }): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: REQUEST_HEADERS,
      body: JSON.stringify(body),
    });
  } catch (err) {
    reportHealth("IMDb", "error", `${label} → ${errorMessage(err)}`);
    throw err;
  }
  if (!res.ok) {
    reportHealth("IMDb", "error", `${label} → ${res.status}`);
    throw new Error(`IMDb GraphQL ${label} → ${res.status}`);
  }
  reportHealth("IMDb", "ok", `${label} → ${res.status}`);
  return res.json();
}

function extractIdsFromTitles(nodes: { id: string }[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const node of nodes) {
    if (!node.id || !node.id.startsWith("tt") || seen.has(node.id)) continue;
    seen.add(node.id);
    ids.push(node.id);
  }
  return ids;
}

// ─── Charts ──────────────────────────────────────────────────────────────

async function fetchChartTitles(chartType: string, size: number): Promise<string[]> {
  const query = `query ChartTitles($chartType: ChartTitleType!, $first: Int!) {
    chartTitles(chart: { chartType: $chartType }, first: $first) {
      edges { node { id titleText { text } } }
    }
  }`;
  const raw = await graphql(`chartTitles(${chartType})`, {
    query,
    variables: { chartType, first: size },
  });
  const parsed = chartTitlesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`IMDb GraphQL response shape changed: ${parsed.error.message}`);
  }
  if (parsed.data.errors?.length) {
    throw new Error(`IMDb GraphQL error: ${parsed.data.errors.map((e) => e.message).join("; ")}`);
  }
  const edges = parsed.data.data?.chartTitles?.edges ?? [];
  return extractIdsFromTitles(edges.map((e) => e.node));
}

async function fetchBoxOfficeChart(limit: number): Promise<string[]> {
  const query = `query BoxOffice($limit: Int!) {
    boxOfficeWeekendChart(limit: $limit) {
      entries { title { id titleText { text } } }
    }
  }`;
  const raw = await graphql("boxOfficeWeekendChart", { query, variables: { limit } });
  const parsed = boxOfficeResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`IMDb GraphQL response shape changed: ${parsed.error.message}`);
  }
  if (parsed.data.errors?.length) {
    throw new Error(`IMDb GraphQL error: ${parsed.data.errors.map((e) => e.message).join("; ")}`);
  }
  const entries = parsed.data.data?.boxOfficeWeekendChart?.entries ?? [];
  return extractIdsFromTitles(entries.map((e) => e.title));
}

export async function fetchImdbChart(chartId: string): Promise<{ name: string; imdbIds: string[] }> {
  const chart = IMDB_CHARTS[chartId];
  if (!chart) throw new Error(`Unknown IMDb chart: ${chartId}`);

  const imdbIds =
    chart.chartType === "BOX_OFFICE"
      ? await fetchBoxOfficeChart(chart.size)
      : await fetchChartTitles(chart.chartType, chart.size);

  if (imdbIds.length === 0) {
    throw new Error(`No IMDb IDs returned for chart ${chartId}.`);
  }

  return { name: chart.name, imdbIds };
}

// ─── Lists ───────────────────────────────────────────────────────────────

const LIST_PAGE_SIZE = 250;
const MAX_LIST_PAGES = 40; // hard ceiling — 10k items

export async function fetchImdbList(listIdOrUrl: string): Promise<{ title: string; imdbIds: string[] }> {
  let listId = listIdOrUrl.trim();
  const urlMatch = listId.match(/\/list\/(ls\d+)/);
  if (urlMatch) listId = urlMatch[1];
  if (!listId.match(/^ls\d+$/)) {
    throw new Error(`Invalid IMDb list ID: "${listIdOrUrl}". Expected format: ls123456789`);
  }

  const query = `query List($id: ID!, $first: Int!, $after: ID) {
    list(id: $id) {
      id
      name { originalText }
      items(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node { item { ... on Title { id titleText { text } } } }
        }
      }
    }
  }`;

  const ids: string[] = [];
  const seen = new Set<string>();
  let title = listId;
  let cursor: string | null = null;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const raw = await graphql(`list(${listId}) page=${page}`, {
      query,
      variables: { id: listId, first: LIST_PAGE_SIZE, after: cursor },
    });
    const parsed = listResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`IMDb GraphQL list response shape changed: ${parsed.error.message}`);
    }
    if (parsed.data.errors?.length) {
      throw new Error(`IMDb GraphQL error: ${parsed.data.errors.map((e) => e.message).join("; ")}`);
    }
    const list = parsed.data.data?.list;
    if (!list) throw new Error(`IMDb list ${listId} not found or is private.`);

    const originalText = list.name?.originalText;
    if (originalText && page === 0) title = originalText;

    for (const edge of list.items.edges) {
      const id = edge.node.item.id;
      if (!id || !id.startsWith("tt") || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }

    if (!list.items.pageInfo.hasNextPage || !list.items.pageInfo.endCursor) break;
    cursor = list.items.pageInfo.endCursor;
  }

  if (ids.length === 0) {
    throw new Error(`IMDb list ${listId} returned no titles.`);
  }

  return { title, imdbIds: ids };
}
