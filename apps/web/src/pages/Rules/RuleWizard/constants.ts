import type { AiVibe, AiNameStyle } from "./types.ts";

export const VIBES: { value: AiVibe; label: string }[] = [
  { value: "playful", label: "Playful" },
  { value: "serious", label: "Serious" },
  { value: "mixed", label: "Mixed" },
];

export const NAME_STYLES: { value: AiNameStyle; label: string }[] = [
  { value: "short_punchy", label: "Short & punchy" },
  { value: "descriptive", label: "Descriptive" },
];

export const IMDB_CHARTS = [
  { value: "top_250_movies", label: "Top 250 Movies", sectionType: "movie" as const },
  { value: "top_250_tv", label: "Top 250 TV Shows", sectionType: "show" as const },
  { value: "popular_movies", label: "Most Popular Movies", sectionType: "movie" as const },
  { value: "popular_tv", label: "Most Popular TV Shows", sectionType: "show" as const },
  { value: "box_office", label: "Box Office", sectionType: "movie" as const },
];

export const IMDB_CHART_LABELS: Record<string, string> = Object.fromEntries(IMDB_CHARTS.map((c) => [c.value, c.label]));
export const IMDB_CHART_SECTION_TYPE: Record<string, string> = Object.fromEntries(
  IMDB_CHARTS.map((c) => [c.value, c.sectionType]),
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

/**
 * Available `list_source` providers. Marked `disabled` until their backing
 * source has shipped so the picker reflects what's actually wired up.
 * Trakt arrives in a follow-up phase, IMDb stays on its dedicated rule
 * type for the moment to avoid migration churn for existing rules.
 */
export const LIST_PROVIDERS: { value: "mdblist" | "trakt" | "imdb"; label: string; disabled?: boolean }[] = [
  { value: "mdblist", label: "MDBList" },
  { value: "trakt", label: "Trakt", disabled: true },
  { value: "imdb", label: "IMDb", disabled: true },
];

export const LIST_PROVIDER_LABELS: Record<"mdblist" | "trakt" | "imdb", string> = Object.fromEntries(
  LIST_PROVIDERS.map((p) => [p.value, p.label]),
) as Record<"mdblist" | "trakt" | "imdb", string>;
