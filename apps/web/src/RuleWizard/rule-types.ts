import { IMDB_CHART_LABELS, IMDB_CHART_SECTION_TYPE, LIST_PROVIDER_LABELS, SEERR_FILTER_LABELS } from "./constants.ts";
import { hasSourceStep } from "./sources/index.ts";
import type { RuleFormState, SmartFilterGroup, SmartFilterLeaf, SmartFilterNode } from "./types.ts";

/** First leaf in document order, or null if the tree is empty. Used by the
 *  wizard's name-suggestion pass to peek at one representative clause. */
function firstLeaf(node: SmartFilterNode): SmartFilterLeaf | null {
  if (node.kind === "leaf") return node;
  for (const c of node.children) {
    const found = firstLeaf(c);
    if (found) return found;
  }
  return null;
}

/** Flatten every leaf in the tree (in document order). The wizard uses
 *  this to validate that there's at least one clause and that every leaf
 *  has a field/value — independent of grouping. */
function collectLeaves(node: SmartFilterNode): SmartFilterLeaf[] {
  if (node.kind === "leaf") return [node];
  return node.children.flatMap(collectLeaves);
}

function smartFilterIsComplete(group: SmartFilterGroup): boolean {
  const leaves = collectLeaves(group);
  return leaves.length > 0 && leaves.every((l) => !!l.field && !!l.value.trim());
}

export interface RuleType {
  value: string;
  label: string;
  description: string;
  requires?: "omdb" | "seerr" | "tmdb";
  /** Source can produce items not yet in the Plex library (enables arr Actions step). */
  producesExternalItems?: boolean;
}

export const RULE_TYPES: RuleType[] = [
  {
    value: "ai_prompt",
    label: "AI Prompt",
    description: "Generate collections from a custom AI prompt template applied to each section.",
  },
  {
    value: "top_rated",
    label: "Top Rated",
    description: "Group your highest-rated items in the library.",
  },
  {
    value: "lowest_rated",
    label: "Lowest Rated",
    description: "Group your lowest-rated items — useful as a 'maybe skip' shelf.",
  },
  {
    value: "actors",
    label: "Actors",
    description: "Build a collection per leading actor across your library, using TMDb cast data.",
    requires: "tmdb",
  },
  {
    value: "directors",
    label: "Directors",
    description: "Build a collection per director, using TMDb crew data.",
    requires: "tmdb",
  },
  {
    value: "studios",
    label: "Studios",
    description: "Build a collection per production company, using normalized TMDb company data.",
    requires: "tmdb",
  },
  {
    value: "networks",
    label: "Networks",
    description: "Build a collection per TV network (TV sections only), using TMDb network data.",
    requires: "tmdb",
  },
  {
    value: "genres",
    label: "Genres",
    description: "Build a collection per genre, using TMDb's normalized genre list.",
    requires: "tmdb",
  },
  {
    value: "countries",
    label: "Countries",
    description: "Build a collection per country of origin, using TMDb production-country data.",
    requires: "tmdb",
  },
  {
    value: "content_ratings",
    label: "Content Ratings",
    description: "Build a collection per content rating (PG, R, TV-MA, etc.) using TMDb regional certifications.",
    requires: "tmdb",
  },
  {
    value: "imdb_chart",
    label: "IMDb Chart",
    description: "Pull from IMDb charts like Top 250 Movies or Most Popular TV.",
    producesExternalItems: true,
  },
  {
    value: "imdb_list",
    label: "IMDb List",
    description: "Use any public IMDb list URL or list ID.",
    producesExternalItems: true,
  },
  {
    value: "list_source",
    label: "List Source",
    description:
      "Pull items from an external list service (MDBList, more coming soon) and build one collection per section.",
    producesExternalItems: true,
  },
  {
    value: "smart_filter",
    label: "Smart Filter",
    description:
      "Build a single collection by AND'ing Plex filter clauses (genre, year, studio, …). Mirrors a Plex smart collection but materialised as a regular collection on the rule's schedule.",
  },
  {
    value: "rt_top_rated",
    label: "RT Top Rated",
    description: "Pull from Rotten Tomatoes top-rated items via OMDB.",
    requires: "omdb",
  },
  {
    value: "seerr_requests",
    label: "Seerr Requests",
    description: "Group items requested via Jellyseerr/Overseerr.",
    requires: "seerr",
    producesExternalItems: true,
  },
  {
    value: "tmdb_popular_actors",
    label: "Popular Actors",
    description: "Build a collection per popular actor (TMDb). Pairs well with the arr action to fill filmographies.",
    requires: "tmdb",
    producesExternalItems: true,
  },
  {
    value: "tmdb_popular_directors",
    label: "Popular Directors",
    description:
      "Build a collection per popular director (TMDb). Pairs well with the arr action to fill filmographies.",
    requires: "tmdb",
    producesExternalItems: true,
  },
  {
    value: "tmdb_franchises",
    label: "Franchises",
    description:
      "Build a collection per movie franchise (TMDb). Pairs well with the arr action to fill franchise gaps.",
    requires: "tmdb",
    producesExternalItems: true,
  },
  {
    value: "decades",
    label: "Decades",
    description: "Build a collection per decade (1990s, 2000s, …) from each item's release year.",
  },
  {
    value: "years",
    label: "Years",
    description: "Build a collection per release year. Best paired with a section that has a clear date range.",
  },
  {
    value: "resolutions",
    label: "Resolutions",
    description: "Group items by Plex's reported video resolution (4K, 1080p, 720p, SD).",
  },
  {
    value: "audio_languages",
    label: "Audio Languages",
    description: "Group items by primary audio stream language, read from Plex media info.",
  },
  {
    value: "subtitle_languages",
    label: "Subtitle Languages",
    description: "Group items by available subtitle languages, read from Plex media info.",
  },
  {
    value: "video_formats",
    label: "Video Formats",
    description: "Group items by source format (Bluray, WEB-DL, HDTV, …) inferred from Plex media metadata.",
  },
  {
    value: "streaming",
    label: "Streaming",
    description: "Subset of the Networks rule limited to major streaming services (Netflix, Disney+, etc.).",
    requires: "tmdb",
  },
  {
    value: "based_on",
    label: "Based On",
    description: "Group items by source material — novel, comic, true story, video game, play, short story.",
    requires: "tmdb",
  },
  {
    value: "seasonal",
    label: "Seasonal",
    description:
      "Holiday and season collections (Christmas, Halloween, Valentine's, …) using TMDb keywords + release month.",
    requires: "tmdb",
  },
  {
    value: "awards",
    label: "Awards",
    description:
      "Award-winners collections (Oscars, BAFTAs, Cannes, Golden Globes). Coverage depends on TMDb keyword tagging.",
    requires: "tmdb",
  },
];

export const TYPE_LABELS: Record<string, string> = Object.fromEntries(RULE_TYPES.map((t) => [t.value, t.label]));
const TYPE_BY_VALUE: Record<string, RuleType> = Object.fromEntries(RULE_TYPES.map((t) => [t.value, t]));

// ─── Per-type helpers ───────────────────────────────────────────────────

export function defaultLimitForType(type: string): number {
  if (type === "ai_prompt") return 8;
  if (type === "top_rated" || type === "lowest_rated") return 50;
  if (type === "rt_top_rated") return 100;
  if (type === "seerr_requests") return 50;
  return 10;
}

export function maxLimitForType(type: string): number {
  if (type === "ai_prompt") return 10;
  if (type === "top_rated" || type === "lowest_rated") return 200;
  if (type === "rt_top_rated") return 200;
  if (type === "seerr_requests") return 200;
  return 50;
}

export function typeHasLimit(type: string): boolean {
  return type !== "imdb_chart" && type !== "imdb_list" && type !== "list_source" && type !== "smart_filter";
}

/**
 * Section-type constraint for rule types that only make sense for movies
 * or shows. `imdb_chart` is determined by the selected chart; other
 * constraints are intrinsic to the type.
 */
export function requiredSectionTypeForRule(type: string, chart: string): "movie" | "show" | undefined {
  if (type === "imdb_chart") return IMDB_CHART_SECTION_TYPE[chart] as "movie" | "show" | undefined;
  if (type === "networks") return "show";
  if (type === "tmdb_franchises") return "movie";
  return undefined;
}

export function typeHasSourceStep(type: string): boolean {
  return hasSourceStep(type);
}

export function typeHasActionsStep(type: string): boolean {
  return !!TYPE_BY_VALUE[type]?.producesExternalItems;
}

export function arrServiceForType(type: string, chart: string): "radarr" | "sonarr" {
  if (type === "imdb_chart") return IMDB_CHART_SECTION_TYPE[chart] === "show" ? "sonarr" : "radarr";
  // imdb_list and seerr_requests are mixed; default to radarr — user reviews counts before non-dry-run.
  return "radarr";
}

export function limitFieldLabel(type: string): string {
  if (type === "ai_prompt") return "Collections per section";
  if (type === "top_rated" || type === "lowest_rated" || type === "rt_top_rated") return "Items per collection";
  if (type === "seerr_requests") return "Items in collection";
  return "Max collections";
}

// ─── Wizard-level helpers ───────────────────────────────────────────────

export function aiHasThemes(form: RuleFormState): boolean {
  return form.themes.length > 0 || form.customThemes.some((t) => t.trim().length > 0);
}

/**
 * Auto-suggested rule name shown when entering the review step in create
 * mode without a manually-typed name. Each branch reads only the form
 * fields its rule type touches; falling all the way through (`return ""`)
 * leaves the field blank for the user to fill in.
 */
export function suggestName(form: RuleFormState, _sections: { title: string }[]): string {
  if (form.type === "imdb_chart") return IMDB_CHART_LABELS[form.chart] || "IMDb Chart";
  if (form.type === "imdb_list") {
    const id = form.listId.match(/ls\d+/i)?.[0] || form.listId;
    return id ? `IMDb List ${id}` : "IMDb List";
  }
  if (form.type === "list_source") {
    if (form.collectionName.trim()) return form.collectionName.trim();
    const provider = LIST_PROVIDER_LABELS[form.listProvider] ?? form.listProvider;
    const id = form.listId.trim();
    return id ? `${provider}: ${id}` : provider;
  }
  if (form.type === "smart_filter") {
    if (form.collectionName.trim()) return form.collectionName.trim();
    const head = firstLeaf(form.smartFilter);
    if (!head) return "Smart Filter";
    return head.value.trim() ? `${head.field}: ${head.value.trim()}` : "Smart Filter";
  }
  if (form.type === "seerr_requests") return `Seerr — ${SEERR_FILTER_LABELS[form.filter] || "Requests"}`;
  if (form.type === "ai_prompt") {
    const all = [...form.themes, ...form.customThemes.filter((t) => t.trim().length > 0)];
    if (all.length === 0) return "AI Curated Collections";
    const head = all.slice(0, 2).join(" + ");
    return `AI — ${head}${all.length > 2 ? " +more" : ""}`.slice(0, 60);
  }
  if (form.type === "rt_top_rated") return "Rotten Tomatoes Top Rated";
  if (form.type === "top_rated") return "Top Rated";
  if (form.type === "lowest_rated") return "Lowest Rated";
  if (form.type === "actors") return "By Actor";
  if (form.type === "directors") return "By Director";
  if (form.type === "studios") return "By Studio";
  if (form.type === "networks") return "By Network";
  if (form.type === "genres") return "By Genre";
  if (form.type === "countries") return "By Country";
  if (form.type === "content_ratings") return "By Content Rating";
  if (form.type === "tmdb_popular_actors") return "Popular Actors";
  if (form.type === "tmdb_popular_directors") return "Popular Directors";
  if (form.type === "tmdb_franchises") return "Franchises";
  return "";
}

// ─── Steps ──────────────────────────────────────────────────────────────

export type StepId = "type" | "source" | "scope" | "actions" | "review";

export function stepsFor(type: string, mode: "create" | "edit"): { id: StepId; label: string }[] {
  const steps: { id: StepId; label: string }[] = [];
  if (mode === "create") steps.push({ id: "type", label: "Type" });
  if (typeHasSourceStep(type)) steps.push({ id: "source", label: "Source" });
  steps.push({ id: "scope", label: "Scope" });
  if (typeHasActionsStep(type)) steps.push({ id: "actions", label: "Actions" });
  steps.push({ id: "review", label: "Review" });
  return steps;
}

// ─── Validation ─────────────────────────────────────────────────────────

export function validateStep(step: StepId, form: RuleFormState): string | null {
  if (step === "type") return form.type ? null : "Pick a rule type.";
  if (step === "source") {
    if (form.type === "ai_prompt" && !aiHasThemes(form)) return "Pick at least one theme (or add a custom one).";
    if (form.type === "imdb_list" && !form.listId.trim()) return "An IMDb list ID or URL is required.";
    if (form.type === "list_source") {
      if (!form.listProvider) return "Pick a list provider.";
      if (!form.listId.trim()) return "A list ID is required.";
    }
    if (form.type === "smart_filter") {
      const leaves = collectLeaves(form.smartFilter);
      if (leaves.length === 0) return "Add at least one filter clause.";
      if (leaves.some((f) => !f.field || !f.value.trim())) return "Every filter clause needs a field and value.";
    }
    return null;
  }
  if (step === "scope") return null;
  if (step === "actions") {
    if (form.arr.enabled) {
      if (!form.arr.qualityProfileId) return "Pick a quality profile.";
      if (!form.arr.rootFolderPath) return "Pick a root folder.";
    }
    return null;
  }
  if (step === "review") return form.name.trim() ? null : "Name is required.";
  return null;
}

export function isFormValid(form: RuleFormState): boolean {
  return (
    !!form.name.trim() &&
    !!form.type &&
    (form.type !== "ai_prompt" || aiHasThemes(form)) &&
    (form.type !== "imdb_list" || !!form.listId.trim()) &&
    (form.type !== "list_source" || (!!form.listProvider && !!form.listId.trim())) &&
    (form.type !== "smart_filter" || smartFilterIsComplete(form.smartFilter)) &&
    (!form.arr.enabled || (!!form.arr.qualityProfileId && !!form.arr.rootFolderPath))
  );
}
