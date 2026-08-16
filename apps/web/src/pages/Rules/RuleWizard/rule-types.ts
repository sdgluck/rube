import {
  defaultMinItemsForRuleType,
  fieldLabel,
  isDestructiveMode,
  isGroupedRuleType,
  minItemsOnByDefault,
  posterUrlError,
  producesManyCollections,
  templateError,
  type RuleTypeValue,
} from "@tinkerbell/contracts";
import { cleanupPreset } from "./cleanup-presets.ts";
import { IMDB_CHART_LABELS, IMDB_CHART_SECTION_TYPE, LIST_PROVIDER_LABELS, SEERR_FILTER_LABELS } from "./constants.ts";
// The type list, not the map of components — this module is imported by
// tests, and the components bring React with them.
import { hasSourceStep } from "./sources/step-types.ts";
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
  /** Constrained to the canonical list in `@tinkerbell/contracts` so a type
   *  the generate job can't dispatch can't be offered in the wizard. */
  value: RuleTypeValue;
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
    description: "Group items requested via Seerr.",
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

/**
 * Which types build one collection per group — and of those, which take a
 * real cap vs. a TMDb fetch budget — is shared with the job via contracts,
 * so the wizard can't drift from what the handlers actually do.
 */
export function typeIsGrouped(type: string): boolean {
  return isGroupedRuleType(type);
}

/** Collections-per-rule can run into the hundreds — pin rotation is required. */
export function typeProducesManyCollections(type: string): boolean {
  return producesManyCollections(type);
}

/** Whether the wizard offers the optional "only groups with N+ items" floor. */
export function typeHasMinItems(type: string): boolean {
  return typeProducesManyCollections(type);
}

/**
 * Pre-filled value for the min-items floor — and, for the types that fan out
 * hardest, the value a new rule starts with the floor already switched on.
 * Shared with contracts so the wizard's default and the volume estimate that
 * justifies it can't drift apart.
 */
export function defaultMinItemsForType(type: string): number {
  return defaultMinItemsForRuleType(type);
}

/**
 * Whether a new rule of this type starts with the floor on. High-cardinality
 * types do: "one collection per production company, including the ones with a
 * single film" is a setting nobody chooses on purpose, so it shouldn't be
 * what they get by not choosing.
 */
export function typeMinItemsOnByDefault(type: string): boolean {
  return typeHasMinItems(type) && minItemsOnByDefault(type);
}

export function defaultLimitForType(type: string): number {
  if (type === "ai_prompt") return 8;
  if (type === "top_rated" || type === "lowest_rated") return 50;
  if (type === "rt_top_rated") return 100;
  if (type === "seerr_requests") return 50;
  if (type === "tmdb_popular_actors" || type === "tmdb_popular_directors") return 10;
  if (type === "tmdb_franchises") return 25;
  // Grouped rules: 0 means "no cap", the default.
  return 0;
}

export function typeHasLimit(type: string): boolean {
  return (
    type === "ai_prompt" ||
    type === "top_rated" ||
    type === "lowest_rated" ||
    type === "rt_top_rated" ||
    type === "seerr_requests" ||
    producesManyCollections(type)
  );
}

/** Grouped rules render the limit as an opt-in checkbox + number. */
export function typeHasOptionalLimit(type: string): boolean {
  return isGroupedRuleType(type);
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
  if (type === "tmdb_popular_actors") return "Popular actors to fetch";
  if (type === "tmdb_popular_directors") return "Popular directors to fetch";
  if (type === "tmdb_franchises") return "Franchise groups to scan";
  return "Max collections";
}

/** Noun for the thing a grouped rule builds one collection per. */
export function groupNounForType(type: string): string {
  const nouns: Record<string, string> = {
    actors: "actor",
    directors: "director",
    studios: "studio",
    networks: "network",
    genres: "genre",
    countries: "country",
    content_ratings: "content rating",
    streaming: "streaming service",
    decades: "decade",
    years: "year",
    resolutions: "resolution",
    audio_languages: "audio language",
    subtitle_languages: "subtitle language",
    video_formats: "video format",
    based_on: "source type",
    seasonal: "season",
    awards: "award",
    tmdb_popular_actors: "actor",
    tmdb_popular_directors: "director",
    tmdb_franchises: "franchise",
  };
  return nouns[type] ?? "group";
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
    // A preset's own label beats a clause dump: "Never watched" reads better
    // than "Watched by nobody: 1", and it is what the user picked.
    const preset = cleanupPreset(form.cleanupPreset);
    if (preset) return preset.label;
    const head = firstLeaf(form.smartFilter);
    if (!head) return "Smart Filter";
    return head.value.trim() ? `${fieldLabel(head.field)}: ${head.value.trim()}` : "Smart Filter";
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

/**
 * Selection types that answer "which items", rather than "how should the
 * library be sliced into groups".
 *
 * Every rule type builds a set of items, but a grouped type builds one set per
 * director, per decade, per genre — and the grouping is the whole of its
 * meaning. That is exactly right for a collection and meaningless for the
 * other two outcomes: "one collection per director, then delete them" and "one
 * collection per director, then retitle them" are both just "every item with a
 * director". `ai_prompt` is excluded for the same reason and one more — what it
 * returns is a judgement call the model makes fresh on each run, which is not
 * something to hand a delete action.
 */
export const ITEM_SELECTION_RULE_TYPES: readonly RuleTypeValue[] = [
  "smart_filter",
  "top_rated",
  "lowest_rated",
  "imdb_chart",
  "imdb_list",
  "list_source",
  "rt_top_rated",
  "seerr_requests",
];

const ITEM_SELECTION = new Set<string>(ITEM_SELECTION_RULE_TYPES);

/**
 * The types offered on the Type step, for the outcome the wizard was opened
 * with. Collections keep the full catalogue; the other two get the list above.
 */
export function ruleTypesFor(outcomeKind: "collection" | "cleanup" | "metadata"): RuleType[] {
  if (outcomeKind === "collection") return RULE_TYPES;
  return RULE_TYPES.filter((t) => ITEM_SELECTION.has(t.value));
}

// ─── Steps ──────────────────────────────────────────────────────────────

export type StepId = "type" | "source" | "scope" | "outcome" | "presentation" | "actions" | "review";

export function stepsFor(
  type: string,
  mode: "create" | "edit",
  outcomeKind: "collection" | "cleanup" | "metadata" = "collection",
): { id: StepId; label: string }[] {
  const steps: { id: StepId; label: string }[] = [];
  if (mode === "create") steps.push({ id: "type", label: "Type" });
  if (typeHasSourceStep(type)) steps.push({ id: "source", label: "Source" });
  // The outcome is not a question the wizard asks: which page you started from
  // is the answer, and both pages list only their own kind, so choosing the
  // other one here built a rule that vanished on save. A collection rule
  // therefore has nothing to configure and skips the step entirely; a cleanup
  // rule keeps it for the knobs — the action, the streak, the caps.
  //
  // It stays ahead of Scope because it decides what Scope asks: a cleanup rule
  // never pins anything, so its homepage questions are dropped.
  if (outcomeKind === "cleanup") steps.push({ id: "outcome", label: "Cleanup" });
  // A metadata rule keeps the step for the same reason and drops the same
  // later ones: it builds no collection, so it pins nothing and there is no
  // shelf to describe or illustrate.
  if (outcomeKind === "metadata") steps.push({ id: "outcome", label: "Fields" });
  steps.push({ id: "scope", label: "Scope" });
  // A cleanup rule's shelf is deliberately plain: the job gives it neither a
  // summary nor a poster, so asking would be asking about something nothing
  // reads — the same reasoning that drops the pinning questions.
  if (outcomeKind === "collection") steps.push({ id: "presentation", label: "Look" });
  if (typeHasActionsStep(type)) steps.push({ id: "actions", label: "Actions" });
  steps.push({ id: "review", label: "Review" });
  return steps;
}

// ─── Validation ─────────────────────────────────────────────────────────

/**
 * Whether this rule puts anything on a homepage at all.
 *
 * Cleanup rules do build a collection — the "on the chopping block" shelf —
 * but the job pins it `false` unconditionally, because a homepage row of
 * films about to be deleted isn't what anyone wants to open Plex to. So every
 * pin setting is dead config on a cleanup rule, and the wizard neither asks
 * about them nor saves them.
 */
export function rulePins(form: RuleFormState): boolean {
  return form.outcome.kind === "collection" && form.pinToHomepage;
}

/**
 * A rule that can produce hundreds of collections has to say how many of
 * them are on the homepage at once — pinning all of them buries every other
 * row. So for those types "pin" and "rotate N" are one decision, not two.
 */
export function pinRotationError(form: RuleFormState): string | null {
  // A cleanup rule's shelf is never pinned, so there is nothing to answer —
  // demanding a rotation count would block a rule that can't use one.
  if (!rulePins(form)) return null;
  if (!typeProducesManyCollections(form.type)) return null;
  return form.pinRotationCount > 0 ? null : "Choose how many collections to keep on the homepage at a time.";
}

/**
 * A cleanup rule has to be spelled out before it can be saved.
 *
 * The streak floor is the important one: `consecutiveRuns: 1` means the very
 * first match deletes, which removes the only protection against a metadata
 * blip. The schema permits it (an expert may genuinely want it on a labelling
 * rule) but the wizard will not hand it to someone by accident.
 */
export function outcomeError(form: RuleFormState): string | null {
  const o = form.outcome;
  if (o.kind === "metadata") return metadataOutcomeError(o);
  if (o.kind !== "cleanup") return null;
  if (!o.mode) return "Choose what should happen to matching items.";
  if (o.consecutiveRuns < 1) return "Items must match at least one run.";
  if (isDestructiveMode(o.mode) && o.consecutiveRuns < 2) {
    return "A rule that removes things must require at least two consecutive matching runs.";
  }
  if (o.maxActionsPerRun < 1) return "Set a per-run limit of at least one item.";
  return null;
}

/**
 * A metadata rule has to say what it writes, and say it in tokens that exist.
 *
 * The empty case matters more than it looks: a rule saved with every field
 * blank runs nightly, matches a thousand items and does nothing, and the only
 * evidence is a log nobody reads. The token check is here as well as in the
 * schema because the wizard can say which field is wrong while the user is
 * still looking at it.
 */
function metadataOutcomeError(o: RuleFormState["outcome"]): string | null {
  for (const [field, template] of Object.entries(o.set)) {
    if (!template) continue;
    const error = templateError(template);
    if (error) return `${field}: ${error}`;
  }
  const writesSomething =
    Object.values(o.set).some((v) => v.trim() !== "") ||
    o.addGenres.length > 0 ||
    o.addLabels.length > 0 ||
    o.removeGenres.length > 0 ||
    o.removeLabels.length > 0;
  if (!writesSomething) return "Set at least one field, or add or remove at least one tag.";
  if (o.maxWritesPerRun < 1) return "Set a per-run limit of at least one field.";
  if (o.sortLanguages.length === 0) {
    return "Choose at least one language for sort titles, or clear the sort title field.";
  }
  return null;
}

/**
 * The two answers a presented rule can get wrong.
 *
 * The URL check is the same one the server and the registry build apply — a
 * poster URL is a host this instance will fetch from on a schedule, so it is
 * HTTPS and allow-listed everywhere, not only where it's convenient.
 */
export function presentationError(form: RuleFormState): string | null {
  const p = form.presentation;
  if (form.outcome.kind !== "collection") return null;
  if (p.summary === "custom" && !p.customSummary.trim()) {
    return "Write the summary, or pick another source.";
  }
  if (p.poster === "url") {
    if (!p.posterUrl.trim()) return "A poster URL is required.";
    const urlError = posterUrlError(p.posterUrl.trim());
    if (urlError) return urlError;
  }
  if (p.accentColor.trim() && !HEX_COLOR.test(p.accentColor.trim())) {
    return "Accent must be a hex colour like #E5A00D.";
  }
  return null;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

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
  if (step === "scope") return pinRotationError(form);
  if (step === "outcome") return outcomeError(form);
  if (step === "presentation") return presentationError(form);
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
    !pinRotationError(form) &&
    !presentationError(form) &&
    (!form.arr.enabled || (!!form.arr.qualityProfileId && !!form.arr.rootFolderPath))
  );
}
