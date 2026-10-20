/**
 * Job config: what each command accepts, and how a stored config is changed.
 *
 * Here rather than in `@tinkerbell/core` because the admin UI renders forms
 * from the same schemas the server validates with, and web may only import
 * contracts. `core` re-exports everything, so command code is unchanged.
 *
 * Every save and every run is checked against the command's schema. They used
 * not to be: the router took any record and the worker checked only
 * `sections`, so a page that saved the fields it knew about silently erased
 * the rest — which is how "Remove Overlays" lost `mode: "remove"` and started
 * *applying* overlays.
 */
import { z } from "zod";
import { customSeasonSchema, seasonOverrideSchema, seasonsConfigIssues } from "./seasons.ts";

/**
 * Bounds for the rule engine's `ruleConcurrency` setting: the schema enforces
 * the max, the job applies the default, and the admin UI renders the input.
 */
export const RULE_CONCURRENCY_DEFAULT = 3;
export const RULE_CONCURRENCY_MAX = 8;

export const commonJobConfigSchema = z.object({
  sections: z.array(z.string()).optional(),
});
export type CommonJobConfig = z.infer<typeof commonJobConfigSchema>;

export const generateJobConfigSchema = commonJobConfigSchema.extend({
  /**
   * How many rules to run at once. Rules are independent, but they share
   * one Plex server and the external APIs behind it, so this is capped low
   * and defaults conservatively — see `RULE_CONCURRENCY_DEFAULT`.
   */
  ruleConcurrency: z.number().int().min(1).max(RULE_CONCURRENCY_MAX).optional(),
});
export type GenerateJobConfig = z.infer<typeof generateJobConfigSchema>;

export const bywJobConfigSchema = commonJobConfigSchema.extend({
  limit: z.number().int().min(1).max(50).optional(),
  mode: z.enum(["per-user", "server"]).optional(),
  users: z.array(z.string()).optional(),
  pinToHomepage: z.boolean().optional(),
  minItems: z.number().int().min(5).max(50).optional(),
  maxItems: z.number().int().min(10).max(100).optional(),
  minLibrarySize: z.number().int().min(1).optional(),
  /** Send the watched title's synopsis with each call, so the model matches on the story and not only the name. */
  includeSynopsis: z.boolean().optional(),
});
export type BywJobConfig = z.infer<typeof bywJobConfigSchema>;

/**
 * We Think You'd Like: one row per person per library, built from their whole
 * recent history rather than one title. Per-user only — there is no server-wide
 * taste to describe, so there is no `mode`.
 */
export const wtylJobConfigSchema = commonJobConfigSchema.extend({
  users: z.array(z.string()).optional(),
  /** How far back the taste profile reads, capped in practice by playback retention. */
  historyDays: z.number().int().min(30).max(3650).optional(),
  /** Fewer distinct titles than this is too little history to call a taste. */
  minHistoryTitles: z.number().int().min(1).max(100).optional(),
  pinToHomepage: z.boolean().optional(),
  minItems: z.number().int().min(5).max(50).optional(),
  maxItems: z.number().int().min(10).max(100).optional(),
  minLibrarySize: z.number().int().min(1).optional(),
});
export type WtylJobConfig = z.infer<typeof wtylJobConfigSchema>;

/**
 * Pick It Back Up: one row per person per TV library of the shows they started
 * and stopped. No AI and no taste — what someone was halfway through is a fact
 * in the playback log — so there is nothing to tune but where "stopped" starts
 * and where it turns into "gave up".
 */
export const pibuJobConfigSchema = commonJobConfigSchema.extend({
  users: z.array(z.string()).optional(),
  /** Not watched for this long counts as stopped. Shorter is still being watched. */
  stallDays: z.number().int().min(3).max(365).optional(),
  /** Not watched for longer than this counts as given up, and is left alone. */
  maxStallDays: z.number().int().min(30).max(3650).optional(),
  /** Fewer finished episodes than this is a sampled pilot, not a show they were into. */
  minEpisodes: z.number().int().min(1).max(20).optional(),
  maxItems: z.number().int().min(1).max(50).optional(),
  pinToHomepage: z.boolean().optional(),
});
export type PibuJobConfig = z.infer<typeof pibuJobConfigSchema>;

/**
 * Finish the Franchise: one row per person per film library of the next film
 * in each series they've started. No AI — what they've seen is in the
 * playback ledger and a series' order is on TMDb.
 */
export const franchiseJobConfigSchema = commonJobConfigSchema.extend({
  users: z.array(z.string()).optional(),
  /** A series nobody has touched in this long is one they've left, and drops out. */
  maxIdleDays: z.number().int().min(30).max(3650).optional(),
  /** Films finished before a series counts as started. */
  minWatched: z.number().int().min(1).max(10).optional(),
  maxItems: z.number().int().min(1).max(50).optional(),
  pinToHomepage: z.boolean().optional(),
  /** When the next part isn't in the library, offer the one after it instead of nothing. */
  skipMissing: z.boolean().optional(),
});
export type FranchiseJobConfig = z.infer<typeof franchiseJobConfigSchema>;

/**
 * Your Requests Are Here: one row per person per library of what they asked
 * for in Overseerr that has arrived and they haven't got to yet.
 */
export const requestsJobConfigSchema = commonJobConfigSchema.extend({
  users: z.array(z.string()).optional(),
  /** Arrivals older than this drop out, watched or not. */
  maxAgeDays: z.number().int().min(7).max(365).optional(),
  maxItems: z.number().int().min(1).max(50).optional(),
  pinToHomepage: z.boolean().optional(),
});
export type RequestsJobConfig = z.infer<typeof requestsJobConfigSchema>;

/**
 * Season Collections: a row per holiday per library, there only while the
 * holiday is. `server` builds one row everybody sees and needs nothing set up;
 * `per-user` builds one per person, ranked by their taste, and needs
 * Personalized Home Screens like the other personal rows.
 *
 * The season list itself is `seasons` (overrides of the shipped presets, by
 * key) plus `customSeasons` — see `seasons.ts` for why not one copied list.
 */
export const seasonCollectionsJobConfigSchema = commonJobConfigSchema.extend({
  mode: z.enum(["server", "per-user"]).optional(),
  users: z.array(z.string()).optional(),
  pinToHomepage: z.boolean().optional(),
  minItems: z.number().int().min(1).max(50).optional(),
  maxItems: z.number().int().min(5).max(100).optional(),
  /** Ask the AI provider for more when keywords find fewer than `minItems`. */
  useAi: z.boolean().optional(),
  seasons: z.record(z.string(), seasonOverrideSchema).optional(),
  customSeasons: z.array(customSeasonSchema).max(30).optional(),
});
export type SeasonCollectionsJobConfig = z.infer<typeof seasonCollectionsJobConfigSchema>;

/**
 * Leaving Soon: one row per library of what cleanup is about to delete. The
 * queue decides what is leaving; this only decides how far ahead to look.
 */
export const leavingSoonJobConfigSchema = commonJobConfigSchema.extend({
  /** Include items this many cleanup runs (days) or fewer from being removed. 0 = only what goes next. */
  withinRuns: z.number().int().min(0).max(30).optional(),
  maxItems: z.number().int().min(5).max(100).optional(),
  minItems: z.number().int().min(1).max(20).optional(),
  pinToHomepage: z.boolean().optional(),
});
export type LeavingSoonJobConfig = z.infer<typeof leavingSoonJobConfigSchema>;

export const collectionsSweepJobConfigSchema = commonJobConfigSchema.extend({
  /**
   * Report what would be deleted and stop. Off by default — the job's own log
   * lists every collection before it deletes anything, so the normal run is
   * already auditable after the fact.
   */
  dryRun: z.boolean().optional(),
});
export type CollectionsSweepJobConfig = z.infer<typeof collectionsSweepJobConfigSchema>;

export const collectionArtJobConfigSchema = commonJobConfigSchema.extend({
  /**
   * Restrict the run to these rules. Set by the "Generate artwork now" action
   * on a single rule; absent means every rule that has opted in, which is what
   * the scheduled run does.
   */
  ruleIds: z.array(z.string()).optional(),
  /**
   * Re-render and re-upload even where the input hash says nothing changed.
   * For the case the ledger can't see: someone replaced the poster in Plex by
   * hand and wants Tinkerbell's back.
   */
  force: z.boolean().optional(),
});
export type CollectionArtJobConfig = z.infer<typeof collectionArtJobConfigSchema>;

export const overlaysJobConfigSchema = commonJobConfigSchema.extend({
  mode: z.enum(["apply", "remove"]).optional(),
});
export type OverlaysJobConfig = z.infer<typeof overlaysJobConfigSchema>;

// Not built on the common schema: a digest covers the whole server, and the
// command never reads `sections` — extending it put a library picker on the
// Digest page that did nothing.
export const digestJobConfigSchema = z.object({
  /**
   * How much history the server-wide digest covers, and — via the ledger —
   * how often it may be sent. Each subscriber's own frequency governs theirs.
   */
  frequency: z.enum(["weekly", "monthly"]).optional(),
  /**
   * Fewest new items worth sending for. A digest saying "nothing happened"
   * trains people to ignore the channel, so below this the run records
   * `skipped_empty` and sends nothing — unless something is about to be
   * deleted, which is worth a message on its own.
   */
  minAddedItems: z.number().int().min(0).optional(),
  /** Cap on the tailored list in a per-user digest. */
  userItemCap: z.number().int().min(1).max(25).optional(),
  /** Send the server-wide digest to the admin's subscribed channels. */
  includeServerDigest: z.boolean().optional(),
  /** Send per-user digests by email to portal users who asked for one. */
  includeUserDigests: z.boolean().optional(),
});
export type DigestJobConfig = z.infer<typeof digestJobConfigSchema>;

/** For commands that read no config at all. */
export const noJobConfigSchema = z.object({});

/**
 * The config schema a command validates against, keyed by command name.
 *
 * A command that ignores its config gets the empty schema rather than the
 * common one, so the UI can tell from the schema alone whether a job has a
 * library filter — posters-refresh used to show a sections picker it ignored.
 */
const SCHEMAS_BY_COMMAND: Record<string, z.ZodObject> = {
  "sync-media": commonJobConfigSchema,
  "sync-collections": commonJobConfigSchema,
  shuffle: commonJobConfigSchema,
  label: commonJobConfigSchema,
  "label-undo": commonJobConfigSchema,
  "personalize-enable": commonJobConfigSchema,
  "personalize-disable": commonJobConfigSchema,
  generate: generateJobConfigSchema,
  cleanup: generateJobConfigSchema,
  metadata: generateJobConfigSchema,
  "because-you-watched": bywJobConfigSchema,
  "byw-remove": bywJobConfigSchema,
  "we-think-youd-like": wtylJobConfigSchema,
  "wtyl-remove": wtylJobConfigSchema,
  "pick-it-back-up": pibuJobConfigSchema,
  "pibu-remove": pibuJobConfigSchema,
  "finish-the-franchise": franchiseJobConfigSchema,
  "franchise-remove": franchiseJobConfigSchema,
  "requests-arrived": requestsJobConfigSchema,
  "requests-remove": requestsJobConfigSchema,
  "season-collections": seasonCollectionsJobConfigSchema,
  "season-remove": seasonCollectionsJobConfigSchema,
  "leaving-soon": leavingSoonJobConfigSchema,
  "leaving-remove": leavingSoonJobConfigSchema,
  "collections-sweep": collectionsSweepJobConfigSchema,
  "collection-art": collectionArtJobConfigSchema,
  overlays: overlaysJobConfigSchema,
  digest: digestJobConfigSchema,
};

export function configSchemaFor(command: string): z.ZodObject {
  return SCHEMAS_BY_COMMAND[command] ?? noJobConfigSchema;
}

/**
 * Checks that span fields. Kept out of the schemas as `.refine()`s on purpose:
 * zod refuses to `.extend()` a refined object, and a refine on a schema used
 * to *read* stored rows turns one bad row into a throw everywhere it is read.
 */
export function configIssues(command: string, config: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (command === "because-you-watched" || command === "we-think-youd-like" || command === "season-collections") {
    const min = config.minItems;
    const max = config.maxItems;
    if (typeof min === "number" && typeof max === "number" && min > max) {
      issues.push(`Minimum items (${min}) can't be more than maximum items (${max})`);
    }
  }
  if (command === "leaving-soon") {
    const min = config.minItems;
    const max = config.maxItems;
    if (typeof min === "number" && typeof max === "number" && min > max) {
      issues.push(`Minimum items (${min}) can't be more than maximum items (${max})`);
    }
  }
  if (command === "season-collections") {
    issues.push(...seasonsConfigIssues(config as Parameters<typeof seasonsConfigIssues>[0]));
  }
  if (command === "pick-it-back-up") {
    const from = config.stallDays;
    const to = config.maxStallDays;
    if (typeof from === "number" && typeof to === "number" && from >= to) {
      issues.push(`"Stopped after" (${from} days) has to be shorter than "Given up after" (${to} days)`);
    }
  }
  return issues;
}

/**
 * Config keys a job id always carries, whatever is saved. A job whose identity
 * *is* a config value — `overlays-remove` is the `overlays` command with
 * `mode: "remove"` — would otherwise be one careless save from becoming the
 * other job.
 */
const LOCKED_CONFIG: Record<string, Record<string, unknown>> = {
  "overlays-remove": { mode: "remove" },
};

export function lockedConfigFor(jobId: string): Record<string, unknown> {
  return LOCKED_CONFIG[jobId] ?? {};
}

/**
 * Array keys where "empty" means "everything". Stored as absent rather than
 * `[]` so there is one spelling of "all" and a form can't save the other.
 */
const ALL_WHEN_EMPTY = new Set(["sections", "users", "ruleIds"]);

/**
 * Merge a partial edit into a stored config.
 *
 * - `null` deletes the key — "back to the default".
 * - An empty `sections`/`users`/`ruleIds` deletes the key — "all".
 * - Arrays are replaced whole, never merged element-wise.
 *
 * Patches rather than whole objects because a page only knows the fields it
 * renders. Whole-object replace is still available for the two callers that
 * genuinely mean it (portability import, the Features JSON import).
 */
export function applyConfigPatch(
  stored: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || (ALL_WHEN_EMPTY.has(key) && Array.isArray(value) && value.length === 0)) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export class JobConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobConfigError";
  }
}

function describeZodError(err: z.ZodError): string {
  return err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

/**
 * Validate a whole config for `command` on `jobId`, with that job's locked keys
 * re-applied. Unknown keys are stripped rather than rejected: this also runs on
 * stored rows, which may carry keys from an older release.
 */
export function validateJobConfig(
  command: string,
  jobId: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = configSchemaFor(command).safeParse({ ...config, ...lockedConfigFor(jobId) });
  if (!parsed.success) throw new JobConfigError(describeZodError(parsed.error));
  const issues = configIssues(command, parsed.data);
  if (issues.length) throw new JobConfigError(issues.join("; "));
  return parsed.data;
}

/**
 * Validate a patch's *keys* strictly before merging: a key the command doesn't
 * know is a client bug or a stale form, and saying so beats silently dropping
 * what somebody just typed. Values may be `null` (clear).
 */
export function validateConfigPatch(command: string, patch: Record<string, unknown>): void {
  const shape = configSchemaFor(command).shape;
  const unknown = Object.keys(patch).filter((k) => !(k in shape));
  if (unknown.length)
    throw new JobConfigError(`Unknown setting${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
}
