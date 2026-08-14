import { z } from "zod";
import {
  collectLocalLeaves,
  isLocalField,
  smartFilterGroupSchema,
  splitLocalLeaves,
} from "@tinkerbell/plex-smart-filter";
import { fieldKind, LOCAL_FIELD_DEFS, SMART_FILTER_FIELD_DEFS } from "./smart-filter-fields.ts";

const LOCAL_FIELDS = new Set(LOCAL_FIELD_DEFS.map((d) => d.field));

/**
 * The canonical shape of `rules.config`.
 *
 * This lives in contracts rather than next to the generate job because three
 * places need to agree on it and none of them can import the others: the job
 * parses it at run time, the admin UI writes it, and the registry build
 * validates published packs against it before they ever reach a Plex server.
 * `@tinkerbell/jobs` re-exports it so server-side call sites are unchanged.
 */
const baseRuleConfigSchema = z.object({
  prompt: z.string().optional(),
  themes: z.array(z.string()).optional(),
  customThemes: z.array(z.string()).optional(),
  vibe: z.enum(["playful", "serious", "mixed"]).optional(),
  nameStyle: z.enum(["short_punchy", "descriptive"]).optional(),
  /**
   * How many collections (or items, for single-collection rules) to build.
   * For grouped rules — directors, studios, decades, … — this is opt-in:
   * absent means every group becomes a collection. For the TMDb-sourced
   * rules (popular people, franchises) it's a fetch budget with its own
   * default, since those pay API calls per group.
   */
  limit: z.number().optional(),
  /**
   * Smallest group worth a collection. Absent means no floor, so a director
   * with a single film still gets one — the wizard warns about the volume
   * that implies before saving.
   */
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

/**
 * Reject a filter tree the generate job could only run wrongly.
 *
 * Splitting a boolean tree into "the part Plex can do" and "the part we do" is
 * only valid when the two are AND'd at every level — see `splitLocalLeaves`.
 * The wizard disables local fields inside an OR group, but a rule can also
 * arrive by import or from a registry pack, and neither goes through the
 * wizard. Failing here means the rule is refused at save time with a reason,
 * rather than running and quietly returning the wrong set.
 */
export const ruleConfigSchema = baseRuleConfigSchema.superRefine((config, ctx) => {
  if (!config.smartFilter) return;

  if (splitLocalLeaves(config.smartFilter).error === "local-leaf-in-or-group") {
    ctx.addIssue({
      code: "custom",
      path: ["smartFilter"],
      message:
        "Watch-history fields can only be combined with AND. Inside an OR group Plex would never return the items the local filter needs, so the result would be silently incomplete.",
    });
  }

  // A `tb.` field nobody implements is stripped from the Plex query and then
  // evaluated by nothing — the rule would run clean and ignore the clause.
  // Cheaper to catch here than to explain later.
  for (const leaf of collectLocalLeaves(config.smartFilter)) {
    if (LOCAL_FIELDS.has(leaf.field)) continue;
    ctx.addIssue({
      code: "custom",
      path: ["smartFilter"],
      message: `Unknown watch-history field "${leaf.field}".`,
    });
  }
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

/**
 * Rule types that slice a library into groups and build one collection per
 * group. Their `limit` and `minItems` are opt-in caps — left unset, every
 * director/studio/decade in the library becomes a collection.
 */
export const GROUPED_RULE_TYPES: readonly RuleTypeValue[] = [
  "actors",
  "directors",
  "studios",
  "networks",
  "genres",
  "countries",
  "content_ratings",
  "streaming",
  "decades",
  "years",
  "resolutions",
  "audio_languages",
  "subtitle_languages",
  "video_formats",
  "based_on",
  "seasonal",
  "awards",
];

/**
 * Also one-collection-per-group, but the groups come from TMDb rather than
 * the library — so their `limit` is a fetch budget with a real default, not
 * a collection cap that can be switched off.
 */
export const EXTERNAL_GROUP_RULE_TYPES: readonly RuleTypeValue[] = [
  "tmdb_popular_actors",
  "tmdb_popular_directors",
  "tmdb_franchises",
];

const GROUPED = new Set<string>(GROUPED_RULE_TYPES);
const EXTERNAL_GROUPED = new Set<string>(EXTERNAL_GROUP_RULE_TYPES);

export function isGroupedRuleType(type: string): boolean {
  return GROUPED.has(type);
}

/**
 * True for rule types whose collection count scales with library size.
 * Pinning every one of those would bury the rest of the homepage, so they
 * pin a rotating subset instead — see `pinRotationCount`.
 */
export function producesManyCollections(type: string): boolean {
  return GROUPED.has(type) || EXTERNAL_GROUPED.has(type);
}

/** Rotation size assumed for a many-collection rule that pins without one. */
export const DEFAULT_PIN_ROTATION = 10;

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
 * Derived from the field table in `./smart-filter-fields.ts` so there is
 * only one place to add a field. Scope-qualified variants (`show.genre`,
 * `episode.genre`) aren't listed but are recognised by `isTagField`.
 */
export const TAG_FIELDS: readonly string[] = SMART_FILTER_FIELD_DEFS.filter(
  (d) => d.kind === "tag" && d.source !== "local",
).map((d) => d.field);

/**
 * Local fields are excluded even when their `kind` is `tag`. `tb.watchedBy`
 * holds a Plex account id, not a per-section tag key — running it through the
 * `/library/sections/:id/:field` translation would look up a value that facet
 * has never heard of and silently rewrite or warn on a perfectly good clause.
 * The same exclusion keeps the tag *picker* off it in the UI, which is right
 * for a different reason: it needs a user picker.
 */
export function isTagField(field: string): boolean {
  return !isLocalField(field) && fieldKind(field) === "tag";
}

/**
 * Fields whose values mean nothing on somebody else's Plex server.
 *
 * Tag keys are per-server but *translatable* — the registry resolver swaps
 * display names for local keys on import. These aren't translatable at all:
 * a Plex account id identifies a person, and the people sharing one server
 * are not the people sharing another. A pack referencing one would import
 * cleanly and filter against a stranger's account. The registry build rejects
 * them rather than resolving them.
 */
export const NON_PORTABLE_FIELDS: readonly string[] = ["tb.watchedBy"];

const NON_PORTABLE = new Set<string>(NON_PORTABLE_FIELDS);

export function isNonPortableField(field: string): boolean {
  return NON_PORTABLE.has(field);
}

/** Local field defs, re-exported so callers need only one import. */
export { LOCAL_FIELD_DEFS };
