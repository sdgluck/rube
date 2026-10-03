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
});
export type BywJobConfig = z.infer<typeof bywJobConfigSchema>;

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

export const digestJobConfigSchema = commonJobConfigSchema.extend({
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

export const personalizeJobConfigSchema = commonJobConfigSchema.extend({
  /**
   * Only these opted-in users (by Plex username). Absent means every opted-in
   * user. Targeting narrows; it never overrides consent — a named user who
   * hasn't opted in in the portal is still skipped.
   */
  users: z.array(z.string()).optional(),
  /** Only these personalizable rules, by id. Absent means all of them. */
  ruleIds: z.array(z.string()).optional(),
});
export type PersonalizeJobConfig = z.infer<typeof personalizeJobConfigSchema>;

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
  personalize: personalizeJobConfigSchema,
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
  if (command === "because-you-watched") {
    const min = config.minItems;
    const max = config.maxItems;
    if (typeof min === "number" && typeof max === "number" && min > max) {
      issues.push(`Minimum items (${min}) can't be more than maximum items (${max})`);
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
