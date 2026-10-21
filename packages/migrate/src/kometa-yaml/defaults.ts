import { asStringList } from "./parse.ts";
import type { PlanConfidence, PlanWarning } from "../types.ts";

/**
 * Kometa's `default:` collection files, resolved from a table rather than
 * interpreted.
 *
 * This is the one deliberate shortcut in the importer, and it is worth stating
 * plainly. A Kometa default like `genre` is a several-hundred-line template
 * machine: dynamic collections keyed off the library's own tag list, per-key
 * name formats, poster lookups, exclusion lists, conditionals. Expanding that
 * generically means implementing most of Kometa in TypeScript.
 *
 * But we don't need the machine — we need its *output*, and the output of
 * `default: genre` is "one collection per genre in this library", which is
 * exactly what Rube's `genres` rule already is. So each default maps to
 * a rule type directly, and the template variables that actually change the
 * outcome (`limit`, `include`, `exclude`, `minimum`) are honoured.
 *
 * The cost is that a default customised in a way this table doesn't model
 * produces a rule that behaves subtly differently. That's what the
 * `unhandled variables` warning is for: the user sees exactly which knobs
 * didn't come across, on the definition they were set on.
 */

export interface DefaultMapping {
  ruleType: string;
  /**
   * What to call the rule this default becomes.
   *
   * Derived names read like machine output — "Chart Imdb", "Award Oscars",
   * "Resolution Standards" — and they end up as the rule names somebody lives
   * with in their rules list, so they're written out rather than title-cased
   * from the file path.
   */
  label: string;
  /** Fixed config every instance of this default gets. */
  baseConfig?: Record<string, unknown>;
  /** Extra note shown on every rule from this default. */
  note?: string;
  /** Ceiling on how faithful this mapping can be, whatever the variables. */
  confidence?: PlanConfidence;
}

/**
 * The table. Keys are the `default:` value as written in config.yml, minus any
 * `.yml` suffix. Kometa nests some under folders (`award/oscars`, `chart/imdb`)
 * and those paths are the key verbatim.
 */
export const DEFAULT_MAPPINGS: Record<string, DefaultMapping> = {
  // ─── Straight grouped equivalents ───────────────────────────────────────
  genre: { label: "Genres", ruleType: "genres" },
  actor: { label: "Actors", ruleType: "actors" },
  director: { label: "Directors", ruleType: "directors" },
  studio: { label: "Studios", ruleType: "studios" },
  network: { label: "Networks", ruleType: "networks" },
  country: { label: "Countries", ruleType: "countries" },
  decade: { label: "Decades", ruleType: "decades" },
  year: { label: "Years", ruleType: "years" },
  resolution: { label: "Resolutions", ruleType: "resolutions" },
  audio_language: { label: "Audio languages", ruleType: "audio_languages" },
  subtitle_language: { label: "Subtitle languages", ruleType: "subtitle_languages" },
  streaming: { label: "Streaming services", ruleType: "streaming" },
  based: { label: "Based on", ruleType: "based_on" },
  seasonal: { label: "Seasonal", ruleType: "seasonal" },
  franchise: { label: "Franchises", ruleType: "tmdb_franchises" },
  resolution_standards: { label: "Video formats", ruleType: "video_formats" },

  // Content ratings ship per-region in Kometa; Rube's rule reads
  // whatever ratings the library actually carries, so every region lands on
  // the same rule type.
  content_rating_us: { label: "Content ratings", ruleType: "content_ratings" },
  content_rating_uk: { label: "Content ratings", ruleType: "content_ratings" },
  content_rating_de: { label: "Content ratings", ruleType: "content_ratings" },
  content_rating_au: { label: "Content ratings", ruleType: "content_ratings" },
  content_rating_nz: { label: "Content ratings", ruleType: "content_ratings" },
  content_rating_cs: { label: "Content ratings", ruleType: "content_ratings" },
  content_rating_mal: { label: "Content ratings", ruleType: "content_ratings" },

  // ─── Close, with a caveat ──────────────────────────────────────────────
  universe: {
    label: "Franchises",
    ruleType: "tmdb_franchises",
    confidence: "partial",
    note: "Kometa's universe collections (MCU, DCEU…) are hand-curated; Rube builds franchises from TMDb, so the groupings will differ.",
  },
  writer: {
    label: "Writers",
    ruleType: "directors",
    confidence: "partial",
    note: "Rube has no writer rule, so this was migrated as a directors rule — the collections it builds will be different.",
  },
  producer: {
    label: "Producers",
    ruleType: "directors",
    confidence: "partial",
    note: "Rube has no producer rule, so this was migrated as a directors rule — the collections it builds will be different.",
  },

  // ─── Awards ────────────────────────────────────────────────────────────
  // Kometa ships one file per ceremony; Rube has a single awards rule
  // that groups by award, so several defaults collapse onto it. The plan
  // de-duplicates identical rules per section, so a config using five award
  // defaults doesn't produce five copies.
  "award/oscars": { label: "Awards", ruleType: "awards" },
  "award/emmy": { label: "Awards", ruleType: "awards" },
  "award/golden": { label: "Awards", ruleType: "awards" },
  "award/bafta": { label: "Awards", ruleType: "awards" },
  "award/cannes": { label: "Awards", ruleType: "awards" },
  "award/spirit": { label: "Awards", ruleType: "awards" },
  "award/sundance": { label: "Awards", ruleType: "awards" },
  "award/choice": { label: "Awards", ruleType: "awards" },
  "award/berlinale": { label: "Awards", ruleType: "awards" },
  "award/venice": { label: "Awards", ruleType: "awards" },
  "award/other": { label: "Awards", ruleType: "awards" },
  award: { label: "Awards", ruleType: "awards" },

  // ─── Charts ────────────────────────────────────────────────────────────
  "chart/imdb": {
    label: "IMDb Top 250",
    ruleType: "imdb_chart",
    baseConfig: { chart: "top_250_movies" },
    confidence: "close",
    note: "Kometa's IMDb chart file builds several charts; Rube created the Top 250. Add rules for the others if you want them.",
  },
  "chart/tmdb": {
    label: "Top rated",
    ruleType: "top_rated",
    confidence: "partial",
    note: "Rube's top-rated rule ranks your own library rather than TMDb's global charts, so the contents will differ.",
  },
};

/**
 * Defaults whose *concept* doesn't exist in Rube, so there is nothing to
 * migrate and nothing lost. These become an info diagnostic — mentioned, but
 * not listed as a gap, because calling them one would imply a feature is
 * missing when the design simply differs.
 */
export const DEFAULT_SKIPPED: Record<string, string> = {
  separator: "Kometa separator collections exist to break up the Plex library view; Rube doesn't use them.",
  collectionless: "Kometa's 'collectionless' collection has no Rube equivalent.",
};

/**
 * Defaults a user would reasonably expect to come across, and which don't.
 *
 * Kept separate from `DEFAULT_SKIPPED` on purpose. These are real losses, so
 * they belong in the not-migrated report the user actually reads — burying
 * "your anime charts didn't migrate" in an info diagnostic is how somebody
 * turns Kometa off and then discovers a hole.
 */
export const DEFAULT_UNSUPPORTED: Record<string, string> = {
  subgenre: "Sub-genre collections aren't supported yet.",
  aspect: "Aspect-ratio collections aren't supported yet.",
  "chart/anilist": "AniList charts aren't supported.",
  "chart/myanimelist": "MyAnimeList charts aren't supported.",
  "chart/trakt": "Trakt charts aren't supported yet — Trakt *lists* are.",
  "chart/other": "This chart file mixes sources Rube doesn't all support.",
  "chart/basic": "This chart file mixes sources Rube doesn't all support.",
};

export interface ResolvedDefault {
  ruleType: string;
  /** Display name for the rule, e.g. "Genres". */
  label: string;
  ruleConfig: Record<string, unknown>;
  confidence: PlanConfidence;
  warnings: PlanWarning[];
}

/**
 * Template variables whose effect we model. Anything set outside this list is
 * reported on the rule it was set on, so a user who tuned a default can see
 * precisely which of their tuning survived.
 */
const HANDLED_VARS = new Set([
  "limit",
  "minimum",
  "include",
  "exclude",
  "schedule",
  "sort_by",
  "collection_mode",
  "collection_order",
  "name_format",
  "summary_format",
  "sync_mode",
  "url_poster",
  "use_separator",
  "separator",
  "style",
  "sep_style",
  "language",
  "translation_module",
]);

/** Variables that change what a rule produces, but which we can't honour. */
const LOSSY_VARS: Record<string, string> = {
  sort_by: "the collection ordering",
  name_format: "the collection naming format",
  summary_format: "the collection summary format",
  style: "the poster style",
};

export function resolveDefault(
  name: string,
  vars: Record<string, unknown>,
): ResolvedDefault | { skipped: string } | { unsupported: string } | null {
  const key = name.trim().replace(/\.ya?ml$/i, "");

  // Kometa's separator files are named `separator_<thing>`.
  if (key.startsWith("separator")) return { skipped: DEFAULT_SKIPPED.separator! };
  if (key in DEFAULT_SKIPPED) return { skipped: DEFAULT_SKIPPED[key]! };
  if (key in DEFAULT_UNSUPPORTED) return { unsupported: DEFAULT_UNSUPPORTED[key]! };

  const mapping = DEFAULT_MAPPINGS[key];
  if (!mapping) return null;

  const warnings: PlanWarning[] = [];
  const config: Record<string, unknown> = { ...mapping.baseConfig, pinToHomepage: false };
  let confidence: PlanConfidence = mapping.confidence ?? "exact";

  if (mapping.note) {
    warnings.push({ code: "default-approximated", message: mapping.note });
  }

  const limit = Number(vars.limit);
  if (Number.isFinite(limit) && limit > 0) config.limit = limit;

  const minimum = Number(vars.minimum);
  if (Number.isFinite(minimum) && minimum > 0) config.minItems = minimum;

  // `include`/`exclude` are how a defaults user says "all genres except
  // Documentary". Without them a migrated config rebuilds exactly the
  // collections its owner turned off, which is the most annoying possible
  // failure — it looks like the migration ignored them, because it did.
  const include = asStringList(vars.include);
  if (include.length > 0) config.includeValues = include;
  const exclude = asStringList(vars.exclude);
  if (exclude.length > 0) config.excludeValues = exclude;

  for (const [key, label] of Object.entries(LOSSY_VARS)) {
    if (vars[key] != null) {
      warnings.push({
        code: "default-var-dropped",
        message: `\`${key}\` set ${label}, which Rube doesn't carry across.`,
      });
      if (confidence === "exact") confidence = "close";
    }
  }

  const unhandled = Object.keys(vars).filter((k) => !HANDLED_VARS.has(k));
  if (unhandled.length > 0) {
    warnings.push({
      code: "default-vars-unhandled",
      message: `Template variables not applied: ${unhandled.join(", ")}.`,
    });
    if (confidence === "exact") confidence = "close";
  }

  return { ruleType: mapping.ruleType, label: mapping.label, ruleConfig: config, confidence, warnings };
}
