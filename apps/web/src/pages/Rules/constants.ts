import { type RuleFormState, DEFAULT_ARR_FORM } from "#/RuleWizard";
import styles from "./Rules.module.css";

export const RULE_TYPES = [
  { value: "ai_prompt", label: "AI Prompt" },
  { value: "top_rated", label: "Top Rated" },
  { value: "lowest_rated", label: "Lowest Rated" },
  { value: "actors", label: "Actors" },
  { value: "directors", label: "Directors" },
  { value: "studios", label: "Studios" },
  { value: "networks", label: "Networks" },
  { value: "genres", label: "Genres" },
  { value: "countries", label: "Countries" },
  { value: "content_ratings", label: "Content Ratings" },
  { value: "imdb_chart", label: "IMDb Chart" },
  { value: "imdb_list", label: "IMDb List" },
  { value: "list_source", label: "List Source" },
  { value: "smart_filter", label: "Smart Filter" },
  { value: "rt_top_rated", label: "RT Top Rated" },
  { value: "seerr_requests", label: "Seerr Requests" },
  { value: "tmdb_popular_actors", label: "Popular Actors" },
  { value: "tmdb_popular_directors", label: "Popular Directors" },
  { value: "tmdb_franchises", label: "Franchises" },
  { value: "decades", label: "Decades" },
  { value: "years", label: "Years" },
  { value: "resolutions", label: "Resolutions" },
  { value: "audio_languages", label: "Audio Languages" },
  { value: "subtitle_languages", label: "Subtitle Languages" },
  { value: "video_formats", label: "Video Formats" },
  { value: "streaming", label: "Streaming" },
  { value: "based_on", label: "Based On" },
  { value: "seasonal", label: "Seasonal" },
  { value: "awards", label: "Awards" },
];

export const IMDB_CHARTS = [
  { value: "top_250_movies", label: "Top 250 Movies" },
  { value: "top_250_tv", label: "Top 250 TV Shows" },
  { value: "popular_movies", label: "Most Popular Movies" },
  { value: "popular_tv", label: "Most Popular TV Shows" },
  { value: "box_office", label: "Box Office" },
];

export const IMDB_CHART_LABELS: Record<string, string> = Object.fromEntries(
  IMDB_CHARTS.map((c) => [c.value, c.label]),
);

export const SEERR_FILTERS = [
  { value: "all", label: "All Requests" },
  { value: "approved", label: "Approved" },
  { value: "available", label: "Available" },
  { value: "pending", label: "Pending" },
];

export const SEERR_FILTER_LABELS: Record<string, string> = Object.fromEntries(
  SEERR_FILTERS.map((f) => [f.value, f.label]),
);

export const TYPE_LABELS: Record<string, string> = Object.fromEntries(RULE_TYPES.map((t) => [t.value, t.label]));

export const CONFIG_SUMMARY: Record<string, (c: Record<string, unknown>) => string> = {
  ai_prompt: (c) => {
    const themes = (c.themes as string[] | undefined) ?? [];
    const custom = ((c.customThemes as string[] | undefined) ?? []).filter((t) => t.trim().length > 0);
    const all = [...themes, ...custom];
    const themeText = all.length === 0 ? "no themes" : `${all.length} theme${all.length !== 1 ? "s" : ""}`;
    return `${themeText} | Limit: ${c.limit ?? 8} | Min items: ${c.minItems ?? 15}`;
  },
  top_rated: (c) => `${c.limit ?? 50} items`,
  lowest_rated: (c) => `${c.limit ?? 50} items`,
  imdb_chart: (c) => IMDB_CHART_LABELS[c.chart as string] || (c.chart as string) || "—",
  imdb_list: (c) => (c.listId as string) || "—",
  list_source: (c) => `${(c.listProvider as string) || "?"}: ${(c.listId as string) || "—"}`,
  smart_filter: (c) => {
    const filters = (c.filters as Array<{ field: string; op: string; value: string }> | undefined) ?? [];
    return filters.length === 0 ? "no filters" : `${filters.length} clause${filters.length !== 1 ? "s" : ""}`;
  },
  rt_top_rated: (c) => `Top ${c.limit ?? 100} items`,
  seerr_requests: (c) => `${SEERR_FILTER_LABELS[c.filter as string] || "All Requests"} | ${c.limit ?? 50} items`,
};

export const CONFIG_DETAILS: Record<string, (c: Record<string, unknown>) => string> = {
  ai_prompt: (c) => {
    const themes = (c.themes as string[] | undefined) ?? [];
    const custom = ((c.customThemes as string[] | undefined) ?? []).filter((t) => t.trim().length > 0);
    const all = [...themes, ...custom];
    const lines = [
      `Vibe: ${(c.vibe as string) ?? "mixed"}`,
      `Name style: ${(c.nameStyle as string) ?? "short_punchy"}`,
      `Collections per section: up to ${c.limit ?? 8}`,
      `Min items per collection: ${c.minItems ?? 15}`,
      "",
      `Themes (${all.length}):`,
      ...(all.length ? all.map((t) => `  • ${t}`) : ["  (none)"]),
    ];
    return lines.join("\n");
  },
  imdb_chart: (c) => `Chart: ${IMDB_CHART_LABELS[c.chart as string] || c.chart || "—"}`,
  imdb_list: (c) => `List ID: ${c.listId || "—"}`,
  list_source: (c) => {
    const lines = [`Provider: ${(c.listProvider as string) || "—"}`, `List: ${(c.listId as string) || "—"}`];
    if (c.collectionName) lines.push(`Name: ${c.collectionName as string}`);
    return lines.join("\n");
  },
  smart_filter: (c) => {
    const filters = (c.filters as Array<{ field: string; op: string; value: string }> | undefined) ?? [];
    const lines: string[] = [];
    if (c.collectionName) lines.push(`Name: ${c.collectionName as string}`);
    if (filters.length === 0) {
      lines.push("(no filters)");
    } else {
      lines.push("Filters (AND):");
      for (const f of filters) lines.push(`  • ${f.field} ${f.op} ${f.value}`);
    }
    return lines.join("\n");
  },
  seerr_requests: (c) =>
    `Filter: ${SEERR_FILTER_LABELS[c.filter as string] || "All Requests"}\nLimit: ${c.limit ?? 50}`,
};

export const TYPE_BADGE: Record<string, string> = {
  ai_prompt: styles.typeAi,
  imdb_chart: styles.typeImdb,
  imdb_list: styles.typeImdb,
  rt_top_rated: styles.typeRt,
  seerr_requests: styles.typeSeerr,
};

export const EMPTY_FORM: RuleFormState = {
  name: "",
  type: "ai_prompt",
  themes: ["Vibes & tone", "Unexpected pairings"],
  customThemes: [],
  vibe: "mixed",
  nameStyle: "short_punchy",
  limit: 8,
  minItems: 15,
  sections: [],
  chart: "top_250_movies",
  listId: "",
  listProvider: "mdblist",
  collectionName: "",
  filters: [],
  filter: "all",
  pinToHomepage: true,
  arr: { ...DEFAULT_ARR_FORM },
};

export function defaultLimitForType(type: string): number {
  if (type === "ai_prompt") return 8;
  if (type === "top_rated" || type === "lowest_rated") return 50;
  if (type === "rt_top_rated") return 100;
  if (type === "seerr_requests") return 50;
  return 10;
}

export function typeHasLimit(type: string): boolean {
  return type !== "imdb_chart" && type !== "imdb_list" && type !== "list_source" && type !== "smart_filter";
}
