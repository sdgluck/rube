import { z } from "zod";
import {
  collectLocalLeaves,
  isLocalField,
  smartFilterGroupSchema,
  splitLocalLeaves,
} from "@tinkerbell/plex-smart-filter";
import { fieldKind, LOCAL_FIELD_DEFS, SMART_FILTER_FIELD_DEFS } from "./smart-filter-fields.ts";
import { presentationConfigSchema } from "./presentation.ts";
import { ruleScheduleSchema } from "./rule-schedule.ts";
import { templateError } from "./metadata-tokens.ts";

const LOCAL_FIELDS = new Set(LOCAL_FIELD_DEFS.map((d) => d.field));

/**
 * What a cleanup rule does to a matched item, ordered least to most
 * destructive. The wizard defaults to `label` and requires an explicit
 * confirmation to move past `unmonitor`.
 */
export const CLEANUP_MODES = ["label", "collection_only", "unmonitor", "delete"] as const;
export type CleanupMode = (typeof CLEANUP_MODES)[number];

/** Modes that remove or alter something outside Tinkerbell's own bookkeeping. */
export const DESTRUCTIVE_CLEANUP_MODES: readonly CleanupMode[] = ["unmonitor", "delete"];

export function isDestructiveMode(mode: string): boolean {
  return (DESTRUCTIVE_CLEANUP_MODES as readonly string[]).includes(mode);
}

/** Runs an item must match in a row before anything happens to it. */
export const DEFAULT_CONSECUTIVE_RUNS = 3;
/** Per-rule ceiling on actions in a single run, mirroring `arr.maxAddsPerRun`. */
export const DEFAULT_MAX_ACTIONS_PER_RUN = 25;

/** Scalar fields a metadata rule may set. Templated — see `metadata-tokens.ts`. */
export const METADATA_SETTABLE_FIELDS = [
  "title",
  "titleSort",
  "summary",
  "tagline",
  "contentRating",
  "studio",
  "originallyAvailableAt",
] as const;

export type MetadataSettableField = (typeof METADATA_SETTABLE_FIELDS)[number];

/** Tag sets a metadata rule may add to or remove from. */
export const METADATA_RULE_TAG_FIELDS = ["genre", "label"] as const;

/** Per-rule ceiling on field writes in one run. */
export const DEFAULT_MAX_WRITES_PER_RUN = 200;

/**
 * A metadata rule matching more than this share of its sections reads as a
 * filter mistake rather than an instruction — the same guard as cleanup, at
 * the same threshold, because the realistic failure is identical: a smart
 * filter typo that suddenly matches the whole library.
 */
export const IMPLAUSIBLE_METADATA_FRACTION = 0.25;

const metadataSetSchema = z.object(
  Object.fromEntries(METADATA_SETTABLE_FIELDS.map((f) => [f, z.string().optional()])) as Record<
    MetadataSettableField,
    z.ZodOptional<z.ZodString>
  >,
);

const metadataTagsSchema = z.object(
  Object.fromEntries(METADATA_RULE_TAG_FIELDS.map((f) => [f, z.array(z.string()).optional()])) as Record<
    (typeof METADATA_RULE_TAG_FIELDS)[number],
    z.ZodOptional<z.ZodArray<z.ZodString>>
  >,
);

const cleanupActionSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("collection") }),
    z.object({
      kind: z.literal("metadata"),
      /**
       * Applied to every item the rule's selection matched. Values may use
       * the closed token set — `{sortableTitle}` alone answers the most
       * common complaint the feature exists for.
       */
      set: metadataSetSchema.optional(),
      addTags: metadataTagsSchema.optional(),
      removeTags: metadataTagsSchema.optional(),
      /**
       * Lock what we write. Defaults on because an unlocked write is a lie:
       * the next agent refresh reverts it, so the app appears to work and
       * then silently undoes itself.
       */
      lock: z.boolean().default(true),
      /**
       * Write to a field Plex has already locked to a *different* value.
       *
       * Off by default. A locked field is almost always a human's deliberate
       * fix, and the whole point of the lock is that it survives things that
       * run at 2am.
       */
      overwriteLocked: z.boolean().default(false),
      maxWritesPerRun: z.number().int().positive().default(DEFAULT_MAX_WRITES_PER_RUN),
      /**
       * Languages whose leading articles `{sortableTitle}` moves. Stripping
       * "La" is right in a French library and wrong for "La Bamba" in an
       * English one, so the library says which it is.
       */
      sortLanguages: z.array(z.string()).default(["en"]),
      /**
       * Same shape and same reason as cleanup's: the only acceptable default
       * for something that overwrites data nobody else holds a copy of is one
       * you have to switch off.
       */
      dryRun: z.boolean().default(true),
    }),
    z.object({
      kind: z.literal("cleanup"),
      mode: z.enum(CLEANUP_MODES),
      /**
       * The safety valve that makes a scheduled destructive rule tolerable: a
       * metadata blip that makes an item match once can never delete anything,
       * because the streak resets the moment it stops matching.
       */
      consecutiveRuns: z.number().int().min(1).default(DEFAULT_CONSECUTIVE_RUNS),
      maxActionsPerRun: z.number().int().positive().default(DEFAULT_MAX_ACTIONS_PER_RUN),
      /**
       * Delete the file through Radarr/Sonarr rather than Plex alone.
       * Strongly preferred: a Plex-only delete leaves the *Arr record behind,
       * and Radarr will re-download the same film that night.
       */
      viaArr: z.boolean().default(true),
      addImportExclusion: z.boolean().default(false),
      /**
       * Defaults to true, and the only acceptable shape here is a destructive
       * behaviour you have to switch *on*. The wizard shows it as "Preview
       * only — don't touch anything yet" and keeps it checked until the user
       * has seen at least one preview.
       */
      dryRun: z.boolean().default(true),
      /**
       * Hold every destructive action until a human approves that item.
       *
       * `consecutiveRuns` protects against a metadata blip; it does not
       * protect against a filter that is *consistently* wrong, which matches
       * the same 400 films every night and is therefore exactly as confident
       * on run three as on run one. This is the second lock: a rule can be
       * live and scheduled and still not delete anything nobody has looked at.
       *
       * Off by default. On, a rule needs someone at a keyboard, which is the
       * wrong trade for most rules and the right one for the rule that
       * deletes.
       */
      requireApproval: z.boolean().default(false),
    }),
  ])
  .optional();

export type RuleAction = NonNullable<z.infer<typeof cleanupActionSchema>>;
export type CleanupActionConfig = Extract<RuleAction, { kind: "cleanup" }>;
export type MetadataActionConfig = Extract<RuleAction, { kind: "metadata" }>;

/** Normalised action for a rule config. Absent means the collection path. */
export function ruleAction(config: { action?: RuleAction }): RuleAction {
  return config.action ?? { kind: "collection" };
}

export function isCleanupRule(config: { action?: RuleAction }): boolean {
  return config.action?.kind === "cleanup";
}

export function isMetadataRule(config: { action?: RuleAction }): boolean {
  return config.action?.kind === "metadata";
}

/**
 * Whether this action would write anything at all.
 *
 * A metadata rule saved with every field blank is a rule that runs nightly,
 * matches a thousand items, and does nothing — worth catching at save time
 * rather than leaving someone to wonder why the sort titles never changed.
 */
export function metadataActionIsEmpty(action: MetadataActionConfig): boolean {
  const values = [
    ...Object.values(action.set ?? {}),
    ...Object.values(action.addTags ?? {}).flat(),
    ...Object.values(action.removeTags ?? {}).flat(),
  ];
  return values.every((v) => v == null || v === "");
}

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
  /**
   * Libraries this rule covers. Empty or absent means every library.
   *
   * Entries may be section *titles* or section *keys* — the wizard writes
   * titles, migration and hand-written configs write keys, and the engine has
   * always accepted either. Ask `ruleCoversSection` rather than comparing these
   * yourself; the "why did this rule skip my item?" panel compared titles
   * exactly and confidently gave the wrong answer for a key-scoped rule.
   */
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
   * Smallest collection worth a homepage row. Absent (the default) pins
   * whatever the rule builds; set, a collection with fewer items is still
   * created in Plex but never promoted — a "Wes Anderson" row with two films
   * is a thin homepage row, not a bad collection.
   *
   * Distinct from `minItems`, which decides whether the collection exists at
   * all. This one only gates pinning, so a rule can build the long tail and
   * still keep the home to the substantial ones.
   */
  pinMinItems: z.number().int().positive().optional(),
  /**
   * When true, the personalize job also runs this rule per opted-in user,
   * producing a `User:<name>`-labelled variant on their home shaped by their
   * preferences (in addition to the shared collection this rule produces).
   */
  personalizable: z.boolean().optional(),
  /**
   * What happens to the items a rule selects.
   *
   * Deliberately an action on the existing rule types rather than a `cleanup`
   * entry in `RULE_TYPE_VALUES`: selection is already general — a smart filter
   * translates an arbitrary boolean tree into a Plex query — and forking every
   * selection mechanism in two to get a second ending would double the surface
   * for no gain.
   *
   * `undefined` means `{ kind: "collection" }`, so every rule that predates
   * this keeps working untouched and no migration is needed.
   */
  action: cleanupActionSchema,
  /**
   * When this rule runs, if not simply "in the nightly batch".
   *
   * Absent is the behaviour every rule had before this existed, so nothing
   * needs migrating. See `rule-schedule.ts` for what the three parts mean.
   */
  schedule: ruleScheduleSchema.optional(),
  /**
   * How this rule's collections look in Plex — summary and poster.
   *
   * Absent means the defaults in `DEFAULT_PRESENTATION`: a templated summary,
   * and no artwork. Both are chosen so a rule saved before this existed keeps
   * behaving the way it did, except that its collections gain a description —
   * which is additive, reversible, and the whole point.
   */
  presentation: presentationConfigSchema.optional(),
  arr: z
    .object({
      enabled: z.boolean(),
      /**
       * Which Radarr/Sonarr to add to.
       *
       * Absent means the service's default instance — the server the original
       * `global_radarr_*` keys point at — so every rule written before split
       * instances existed keeps targeting exactly what it always did.
       */
      instanceId: z.string().optional(),
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
  // A template naming a token nobody implements would expand to a literal at
  // run time and write "{titel}" into four hundred titles. That has to be a
  // save-time error, and it has to be checked here rather than only in the
  // wizard — a rule can also arrive by import or from a registry pack.
  if (config.action?.kind === "metadata") {
    for (const [field, value] of Object.entries(config.action.set ?? {})) {
      if (typeof value !== "string") continue;
      const error = templateError(value);
      if (error) {
        ctx.addIssue({ code: "custom", path: ["action", "set", field], message: error });
      }
    }
  }

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

/**
 * Does a rule scoped to `scope` cover this section?
 *
 * One predicate, because there were two: the engine matched a lower-cased title
 * or the section key, and `explainItem` matched the title exactly. A rule whose
 * sections were saved as keys was therefore covered by the engine and reported
 * as out of scope by the panel explaining the engine.
 */
export function ruleCoversSection(
  scope: readonly string[] | undefined,
  section: { key: string; title: string },
): boolean {
  if (!scope || scope.length === 0) return true;
  const names = scope.map((s) => s.trim().toLowerCase());
  return names.includes(section.key) || names.includes(section.title.toLowerCase());
}
