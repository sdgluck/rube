import { z } from "zod";
import { smartFilterGroupSchema } from "@tinkerbell/plex-smart-filter";

/**
 * The canonical shape of `rules.config`.
 *
 * This lives in contracts rather than next to the generate job because three
 * places need to agree on it and none of them can import the others: the job
 * parses it at run time, the admin UI writes it, and the registry build
 * validates published packs against it before they ever reach a Plex server.
 * `@tinkerbell/jobs` re-exports it so server-side call sites are unchanged.
 */
export const ruleConfigSchema = z.object({
  prompt: z.string().optional(),
  themes: z.array(z.string()).optional(),
  customThemes: z.array(z.string()).optional(),
  vibe: z.enum(["playful", "serious", "mixed"]).optional(),
  nameStyle: z.enum(["short_punchy", "descriptive"]).optional(),
  limit: z.number().optional(),
  minItems: z.number().optional(),
  sections: z.array(z.string()).optional(),
  chart: z.string().optional(),
  listId: z.string().optional(),
  /** list_source: which external list provider supplies the items. */
  listProvider: z.enum(["mdblist", "trakt", "imdb"]).optional(),
  /** list_source / smart_filter: optional override for the generated collection name. */
  collectionName: z.string().optional(),
  /**
   * smart_filter: recursive boolean tree of clauses translated to a Plex
   * query string at run time. AND/OR groups can nest arbitrarily so any
   * Plex smart-collection filter (including OR-within-field via repeated
   * equality and OR groups via push/or/pop) round-trips cleanly.
   */
  smartFilter: smartFilterGroupSchema.optional(),
  /** seerr-requests: status filter ("all" / "approved" / "pending" / …). */
  filter: z.string().optional(),
  pinToHomepage: z.boolean().optional(),
  /**
   * Pin only this many of the rule's collections per library, rotating a
   * different set in on each run. Unset (or 0) pins every collection, which
   * is the original behaviour.
   */
  pinRotationCount: z.number().int().positive().optional(),
  /**
   * When true, the personalize job also runs this rule per opted-in user,
   * producing a `User:<name>`-labelled variant on their home shaped by their
   * preferences (in addition to the shared collection this rule produces).
   */
  personalizable: z.boolean().optional(),
  arr: z
    .object({
      enabled: z.boolean(),
      monitor: z.boolean(),
      searchOnAdd: z.boolean(),
      qualityProfileId: z.number(),
      rootFolderPath: z.string(),
      maxAddsPerRun: z.number(),
      dryRun: z.boolean(),
    })
    .optional(),
});

export type RuleConfig = z.infer<typeof ruleConfigSchema>;

/**
 * Every rule type the generate job can dispatch. Must stay in step with
 * `handlerForRule()` in `packages/jobs/src/commands/generate/dispatch.ts` —
 * a value here with no handler is a silent no-op at run time, which is
 * exactly the failure the registry's validation test exists to catch.
 */
export const RULE_TYPE_VALUES = [
  "ai_prompt",
  "top_rated",
  "lowest_rated",
  "actors",
  "directors",
  "studios",
  "networks",
  "genres",
  "countries",
  "content_ratings",
  "imdb_chart",
  "imdb_list",
  "list_source",
  "smart_filter",
  "rt_top_rated",
  "seerr_requests",
  "tmdb_popular_actors",
  "tmdb_popular_directors",
  "tmdb_franchises",
  "decades",
  "years",
  "resolutions",
  "audio_languages",
  "subtitle_languages",
  "video_formats",
  "streaming",
  "based_on",
  "seasonal",
  "awards",
] as const;

export type RuleTypeValue = (typeof RULE_TYPE_VALUES)[number];

/** Integrations a rule type cannot run without. `ai_prompt` needs an LLM
 *  provider, which isn't an "integration" in the wizard's sense but gates
 *  the rule just as hard — see `generate/index.ts`, which skips ai_prompt
 *  rules outright when no provider is configured. */
export type RuleRequirement = "omdb" | "seerr" | "tmdb" | "llm" | "mdblist";

export const RULE_TYPE_REQUIRES: Partial<Record<RuleTypeValue, RuleRequirement>> = {
  actors: "tmdb",
  directors: "tmdb",
  studios: "tmdb",
  networks: "tmdb",
  genres: "tmdb",
  countries: "tmdb",
  content_ratings: "tmdb",
  streaming: "tmdb",
  based_on: "tmdb",
  seasonal: "tmdb",
  awards: "tmdb",
  tmdb_popular_actors: "tmdb",
  tmdb_popular_directors: "tmdb",
  tmdb_franchises: "tmdb",
  rt_top_rated: "omdb",
  seerr_requests: "seerr",
  ai_prompt: "llm",
};

/**
 * Plex filter fields whose values are stored as **per-server numeric tag
 * keys** rather than the display name you see in the UI. A rule carrying
 * `genre = "5840"` is meaningless on any other Plex server, so anything
 * crossing an instance boundary (import, export, the registry) has to
 * translate these via `/library/sections/:id/:field`.
 *
 * Mirrors `TAG_FIELDS` in `apps/web/src/components/SmartFiltersEditor.tsx`,
 * plus the `show.`-prefixed advanced variants Plex exposes for TV sections.
 */
export const TAG_FIELDS: readonly string[] = [
  "label",
  "genre",
  "director",
  "actor",
  "writer",
  "studio",
  "country",
  "contentRating",
  "resolution",
  "collection",
  "show.genre",
  "show.studio",
  "show.network",
  "show.collection",
  "show.contentRating",
];

export function isTagField(field: string): boolean {
  return TAG_FIELDS.includes(field);
}
