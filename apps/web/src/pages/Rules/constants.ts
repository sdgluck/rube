import type { SmartFilterGroup, SmartFilterLeaf, SmartFilterNode } from "@tinkerbell/plex-smart-filter";
import { describeCondition, RULE_TRIGGERS } from "@tinkerbell/contracts";
import { type RuleFormState, DEFAULT_ARR_FORM } from "#pages/Rules/RuleWizard";
import {
  DEFAULT_OUTCOME_FORM,
  DEFAULT_PRESENTATION_FORM,
  DEFAULT_SCHEDULE_FORM,
  type OutcomeFormState,
  type PresentationFormState,
  type ScheduleFormState,
} from "./RuleWizard/types.ts";
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

/**
 * Rule types that exist and run, but which the wizard doesn't offer.
 *
 * `static_list` is the only one: it's created by the Kometa migration to adopt
 * a collection Tinkerbell has no builder for, and there's nothing useful a
 * person could do with it from a blank wizard — you'd be typing out a list of
 * films by hand. It still needs a label, because it appears in the rules table
 * like any other rule and "static_list" is not a name.
 */
const UNLISTED_TYPE_LABELS: Record<string, string> = {
  static_list: "Fixed list",
};

export const TYPE_LABELS: Record<string, string> = {
  ...Object.fromEntries(RULE_TYPES.map((t) => [t.value, t.label])),
  ...UNLISTED_TYPE_LABELS,
};

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
  pinMinItems: 0,
  personalizable: false,
  outcome: { ...DEFAULT_OUTCOME_FORM },
  presentation: { ...DEFAULT_PRESENTATION_FORM },
  arr: { ...DEFAULT_ARR_FORM },
  schedule: { ...DEFAULT_SCHEDULE_FORM },
};

/**
 * Read a stored `config.action` back into wizard form state.
 *
 * An absent or unrecognised action is a collection rule — the same reading the
 * generate job takes. Erring the other way would silently turn an ordinary
 * rule into one that removes or rewrites things in the editor.
 */
export function outcomeFromConfig(action: unknown): OutcomeFormState {
  const a = action as { kind?: string } | null | undefined;
  if (a?.kind === "cleanup") {
    return { ...DEFAULT_OUTCOME_FORM, ...(a as Partial<OutcomeFormState>), kind: "cleanup" };
  }
  if (a?.kind === "metadata") {
    const stored = a as {
      set?: Record<string, string>;
      addTags?: { genre?: string[]; label?: string[] };
      removeTags?: { genre?: string[]; label?: string[] };
      lock?: boolean;
      overwriteLocked?: boolean;
      maxWritesPerRun?: number;
      sortLanguages?: string[];
    };
    return {
      ...DEFAULT_OUTCOME_FORM,
      kind: "metadata",
      // Merged over the blank map rather than replacing it: the form's inputs
      // are controlled, and a stored action only carries the fields it writes.
      set: { ...DEFAULT_OUTCOME_FORM.set, ...stored.set },
      addGenres: stored.addTags?.genre ?? [],
      addLabels: stored.addTags?.label ?? [],
      removeGenres: stored.removeTags?.genre ?? [],
      removeLabels: stored.removeTags?.label ?? [],
      lock: stored.lock ?? true,
      overwriteLocked: stored.overwriteLocked ?? false,
      maxWritesPerRun: stored.maxWritesPerRun ?? DEFAULT_OUTCOME_FORM.maxWritesPerRun,
      sortLanguages: stored.sortLanguages ?? ["en"],
      dryRun: (a as { dryRun?: boolean }).dryRun ?? true,
    };
  }
  if (a?.kind === "playlist") {
    const stored = a as {
      playlistName?: string;
      order?: OutcomeFormState["playlistOrder"];
      combineSections?: boolean;
      limit?: number;
    };
    return {
      ...DEFAULT_OUTCOME_FORM,
      kind: "playlist",
      playlistName: stored.playlistName ?? "",
      playlistOrder: stored.order ?? DEFAULT_OUTCOME_FORM.playlistOrder,
      playlistCombineSections: stored.combineSections ?? true,
      playlistLimit: stored.limit ?? 0,
    };
  }
  return { ...DEFAULT_OUTCOME_FORM };
}

/**
 * Read a stored `config.presentation` back into wizard form state.
 *
 * Absent means the defaults, which is what a rule saved before this existed
 * gets: a templated description and no artwork. Optional fields come back as
 * empty strings because the form's inputs are controlled.
 */
export function presentationFromConfig(presentation: unknown): PresentationFormState {
  const p = presentation as Partial<Record<keyof PresentationFormState, unknown>> | null | undefined;
  if (!p) return { ...DEFAULT_PRESENTATION_FORM };
  return {
    summary: (p.summary as PresentationFormState["summary"]) ?? DEFAULT_PRESENTATION_FORM.summary,
    customSummary: (p.customSummary as string) ?? "",
    poster: (p.poster as PresentationFormState["poster"]) ?? DEFAULT_PRESENTATION_FORM.poster,
    posterUrl: (p.posterUrl as string) ?? "",
    accentColor: (p.accentColor as string) ?? "",
  };
}

/**
 * Read a stored `config.schedule` back into wizard form state.
 *
 * The saved shape omits what isn't in use; the form needs every field present
 * to bind controls to. So each half gets a boolean saying whether it's on, and
 * the values behind an off switch fall back to the defaults rather than to
 * empty strings — un-ticking a window and re-ticking it shouldn't leave two
 * blank date boxes.
 */
export function scheduleFromConfig(schedule: unknown): ScheduleFormState {
  const s = schedule as Partial<Record<keyof ScheduleFormState | "triggers", unknown>> | null | undefined;
  if (!s) return { ...DEFAULT_SCHEDULE_FORM };
  const cron = typeof s.cron === "string" ? s.cron : "";
  const activeFrom = typeof s.activeFrom === "string" ? s.activeFrom : "";
  const activeTo = typeof s.activeTo === "string" ? s.activeTo : "";
  const triggers = Array.isArray(s.triggers) ? (s.triggers as string[]) : [];
  const afterRules = Array.isArray(s.afterRules) ? (s.afterRules as unknown[]).map(String) : [];
  return {
    useCron: cron.length > 0,
    cron: cron || DEFAULT_SCHEDULE_FORM.cron,
    excludeFromBatch: s.excludeFromBatch === true,
    useWindow: activeFrom.length > 0 && activeTo.length > 0,
    activeFrom: activeFrom || DEFAULT_SCHEDULE_FORM.activeFrom,
    activeTo: activeTo || DEFAULT_SCHEDULE_FORM.activeTo,
    // Filtered against the known set rather than trusted: a rule imported from
    // a registry pack built against a newer Tinkerbell can name a trigger this
    // build has never heard of, and an unknown checkbox is not a checkbox.
    triggers: RULE_TRIGGERS.filter((t) => triggers.includes(t)),
    afterRules,
  };
}

/**
 * The inverse: only the parts that are switched on reach the config, so a rule
 * that never touched the schedule controls stays byte-identical to how it was
 * stored before they existed. Returns undefined when nothing is set, which is
 * what the job reads as "nightly batch, all year".
 */
export function scheduleToConfig(form: ScheduleFormState): Record<string, unknown> | undefined {
  const schedule: Record<string, unknown> = {};
  if (form.useCron && form.cron.trim()) {
    schedule.cron = form.cron.trim();
    // Only meaningful alongside a cron, and the schema rejects it without one.
    if (form.excludeFromBatch) schedule.excludeFromBatch = true;
  }
  if (form.useWindow && form.activeFrom && form.activeTo) {
    schedule.activeFrom = form.activeFrom;
    schedule.activeTo = form.activeTo;
  }
  if (form.triggers.length > 0) schedule.triggers = form.triggers;
  if (form.afterRules.length > 0) schedule.afterRules = form.afterRules;
  return Object.keys(schedule).length > 0 ? schedule : undefined;
}

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
