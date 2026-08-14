import type { SmartFilterGroup, SmartFilterLeaf, SmartFilterNode } from "@tinkerbell/plex-smart-filter";
import { describeCondition } from "#components/smart-filter/format.ts";
import { type RuleFormState, DEFAULT_ARR_FORM } from "#pages/Rules/RuleWizard";
import { typeProducesManyCollections } from "./RuleWizard/rule-types.ts";
import styles from "./Rules.module.css";

function listSlug(listId: unknown): string {
  const raw = typeof listId === "string" ? listId.trim() : "";
  if (!raw) return "—";
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || raw;
  } catch {
    return raw;
  }
}

/** Every leaf in a smart_filter tree, in document order. */
export function smartFilterLeaves(value: unknown): SmartFilterLeaf[] {
  const root = value as SmartFilterGroup | undefined;
  if (!root || root.kind !== "group") return [];
  const leaves: SmartFilterLeaf[] = [];
  const walk = (node: SmartFilterNode) => {
    if (node.kind === "leaf") leaves.push(node);
    else node.children.forEach(walk);
  };
  walk(root);
  return leaves;
}

/**
 * One line of English for a smart_filter tree, for the rules table's Config
 * column. The column is narrow, so only the leading clauses are spelled out
 * and the rest are counted.
 *
 * `resolveTag` turns a per-server tag key into its name where the caller has
 * the lookup to hand; without it the key shows through.
 */
export function summarizeSmartFilterTree(
  value: unknown,
  resolveTag?: (field: string, value: string) => string,
): string {
  const root = value as SmartFilterGroup | undefined;
  const leaves = smartFilterLeaves(value);
  if (leaves.length === 0) return "no filters";

  const shown = leaves
    .slice(0, 2)
    .map((l) => describeCondition(l.field, l.op, [l.value], resolveTag ? [resolveTag(l.field, l.value)] : undefined));
  const rest = leaves.length - shown.length;
  return shown.join(root?.combinator === "any" ? " or " : " and ") + (rest > 0 ? ` +${rest} more` : "");
}

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

export const IMDB_CHART_LABELS: Record<string, string> = Object.fromEntries(IMDB_CHARTS.map((c) => [c.value, c.label]));

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
  list_source: (c) => `List: ${listSlug(c.listId)}`,
  // The wizard writes `smartFilter` as an AND/OR tree. This read `c.filters`
  // — a flat array that no longer exists — so every smart_filter rule in the
  // list claimed to have no filters.
  smart_filter: (c) => summarizeSmartFilterTree(c.smartFilter),
  rt_top_rated: (c) => `Top ${c.limit ?? 100} items`,
  seerr_requests: (c) => `${SEERR_FILTER_LABELS[c.filter as string] || "All Requests"} | ${c.limit ?? 50} items`,
};

/** Grouped rules all read the same two optional knobs — both off by default. */
function groupedSummary(c: Record<string, unknown>): string {
  const limit = typeof c.limit === "number" && c.limit > 0 ? `Max ${c.limit}` : "No cap";
  const min = typeof c.minItems === "number" && c.minItems > 1 ? `${c.minItems}+ items` : "Any size";
  return `${limit} | ${min}`;
}

for (const { value } of RULE_TYPES) {
  if (typeProducesManyCollections(value) && !CONFIG_SUMMARY[value]) CONFIG_SUMMARY[value] = groupedSummary;
}

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
  smartFilter: { kind: "group", combinator: "all", children: [] },
  filter: "all",
  pinToHomepage: true,
  pinRotationCount: 0,
  arr: { ...DEFAULT_ARR_FORM },
};

// Single source of truth lives with the wizard — re-exported here because
// the Rules page has always imported these from `./constants`.
export {
  defaultLimitForType,
  defaultMinItemsForType,
  typeHasLimit,
  typeHasMinItems,
  typeHasOptionalLimit,
  typeIsGrouped,
  typeProducesManyCollections,
} from "./RuleWizard/rule-types.ts";
