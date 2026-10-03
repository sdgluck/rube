/**
 * What each job's settings form shows: one descriptor per config key, keyed by
 * command, rendered by the admin UI's generic `JobSettingsForm`.
 *
 * Declared beside the schemas (job-config.ts) and checked against them by test,
 * so a key can't be editable in the UI and unknown to the server, or the other
 * way round. Digest's five settings, the sweep's dry run and Metadata's
 * concurrency all existed in the schemas for releases with no way to set them.
 *
 * Defaults live here too, as constants the commands read — so the number the
 * form shows for an unset field is the number the job actually uses.
 */
import { RULE_CONCURRENCY_DEFAULT, RULE_CONCURRENCY_MAX, configSchemaFor, lockedConfigFor } from "./job-config.ts";

export const BYW_DEFAULTS = {
  limit: 10,
  mode: "per-user",
  pinToHomepage: true,
  minItems: 10,
  maxItems: 30,
  minLibrarySize: 15,
} as const;

export const DIGEST_DEFAULTS = {
  frequency: "weekly",
  minAddedItems: 1,
  userItemCap: 5,
  includeServerDigest: true,
  includeUserDigests: true,
} as const;

export type FieldControl =
  | { kind: "number"; min: number; max?: number; unit?: string }
  | { kind: "boolean" }
  | { kind: "enum"; options: { value: string; label: string; help?: string }[] }
  /** Plex libraries, by title. Empty means all. */
  | { kind: "sections" }
  /** Plex users, by username. `opted-in` lists only users who opted in via the portal. */
  | { kind: "users"; source: "plex-users" | "opted-in" }
  /** Rules marked personalizable, by id. */
  | { kind: "rules" };

export interface FieldSpec {
  key: string;
  label: string;
  help?: string;
  control: FieldControl;
  /** What the job uses when the key is unset. Shown in the form; never stored. */
  default?: unknown;
  /** Only shown while another field has this value. */
  showWhen?: { key: string; equals: unknown };
  /** Tucked behind "Advanced" — settings most people never need. */
  advanced?: boolean;
}

const SECTIONS: FieldSpec = {
  key: "sections",
  label: "Libraries",
  help: "Leave all unticked to include every library.",
  control: { kind: "sections" },
};

const RULE_CONCURRENCY: FieldSpec = {
  key: "ruleConcurrency",
  label: "Rules at a time",
  help: "Rules share one Plex server and the same external APIs, so higher isn't always faster.",
  control: { kind: "number", min: 1, max: RULE_CONCURRENCY_MAX },
  default: RULE_CONCURRENCY_DEFAULT,
  advanced: true,
};

/** Fields beyond `sections`, which is added for every command whose schema has it. */
const COMMAND_FIELDS: Record<string, FieldSpec[]> = {
  generate: [RULE_CONCURRENCY],
  cleanup: [RULE_CONCURRENCY],
  metadata: [RULE_CONCURRENCY],
  "because-you-watched": [
    {
      key: "limit",
      label: "Collections",
      help: "How many collections to make per library.",
      control: { kind: "number", min: 1, max: 50 },
      default: BYW_DEFAULTS.limit,
    },
    {
      key: "mode",
      label: "Built from",
      control: {
        kind: "enum",
        options: [
          { value: "per-user", label: "Each user's history", help: "One set of collections per Plex user." },
          { value: "server", label: "Everyone's history", help: "One shared set, from all users' viewing." },
        ],
      },
      default: BYW_DEFAULTS.mode,
    },
    {
      key: "users",
      label: "Users",
      help: "Leave empty to include every user.",
      control: { kind: "users", source: "plex-users" },
      showWhen: { key: "mode", equals: "per-user" },
    },
    {
      key: "pinToHomepage",
      label: "Pin to home screen",
      control: { kind: "boolean" },
      default: BYW_DEFAULTS.pinToHomepage,
    },
    {
      key: "minItems",
      label: "Fewest items",
      help: "A collection with fewer matches than this isn't made.",
      control: { kind: "number", min: 5, max: 50 },
      default: BYW_DEFAULTS.minItems,
      advanced: true,
    },
    {
      key: "maxItems",
      label: "Most items",
      control: { kind: "number", min: 10, max: 100 },
      default: BYW_DEFAULTS.maxItems,
      advanced: true,
    },
    {
      key: "minLibrarySize",
      label: "Smallest library",
      help: "Libraries with fewer items than this are skipped.",
      control: { kind: "number", min: 1, unit: "items" },
      default: BYW_DEFAULTS.minLibrarySize,
      advanced: true,
    },
  ],
  "collections-sweep": [
    {
      key: "dryRun",
      label: "Preview only",
      help: "Report what would be deleted and delete nothing. “Run for real” still deletes, once.",
      control: { kind: "boolean" },
      default: false,
    },
  ],
  digest: [
    {
      key: "frequency",
      label: "Covers",
      help: "How much history the server digest summarises, and how often it may be sent. Each portal user picks their own.",
      control: {
        kind: "enum",
        options: [
          { value: "weekly", label: "The past week" },
          { value: "monthly", label: "The past month" },
        ],
      },
      default: DIGEST_DEFAULTS.frequency,
    },
    {
      key: "includeServerDigest",
      label: "Send to your channels",
      help: "The server-wide digest, to the notification services routed for it.",
      control: { kind: "boolean" },
      default: DIGEST_DEFAULTS.includeServerDigest,
    },
    {
      key: "includeUserDigests",
      label: "Email portal users",
      help: "A tailored digest for each portal user who asked for one.",
      control: { kind: "boolean" },
      default: DIGEST_DEFAULTS.includeUserDigests,
    },
    {
      key: "minAddedItems",
      label: "Skip quiet periods",
      help: "Send nothing when fewer than this many items were added — unless something is about to be removed.",
      control: { kind: "number", min: 0, unit: "items" },
      default: DIGEST_DEFAULTS.minAddedItems,
      advanced: true,
    },
    {
      key: "userItemCap",
      label: "Picks per user digest",
      control: { kind: "number", min: 1, max: 25 },
      default: DIGEST_DEFAULTS.userItemCap,
      showWhen: { key: "includeUserDigests", equals: true },
      advanced: true,
    },
  ],
};

/** Every field the form shows for `command`, libraries first. */
export function fieldsFor(command: string): FieldSpec[] {
  const shape = configSchemaFor(command).shape;
  const extra = COMMAND_FIELDS[command] ?? [];
  return "sections" in shape ? [SECTIONS, ...extra] : extra;
}

/** For the drift test: every command that declares fields. */
export function commandsWithFields(): string[] {
  return Object.keys(COMMAND_FIELDS);
}

/**
 * A one-off way to run a job: overrides applied to a single run and never
 * saved. For options that make sense per run but would be a trap as a stored
 * setting — "force re-render every poster" left switched on re-uploads the
 * whole library every night.
 *
 * The client sends only the variant's id; the server looks the overrides up
 * here, so "Run now" can't be used to run a job with arbitrary config.
 */
export interface VariantSpec {
  id: string;
  label: string;
  description: string;
  overrides: Record<string, unknown>;
  confirm?: { title: string; message: string; danger?: boolean };
}

const COMMAND_VARIANTS: Record<string, VariantSpec[]> = {
  "collections-sweep": [
    {
      id: "preview",
      label: "Preview (dry run)",
      description: "List what would be deleted, and delete nothing.",
      overrides: { dryRun: true },
    },
    {
      id: "delete",
      label: "Run for real",
      description: "Delete the collections this run finds, even though the job is set to preview only.",
      overrides: { dryRun: false },
      confirm: {
        title: "Delete collections now?",
        message:
          "This run deletes every duplicate or orphaned collection it finds from Plex. Run a preview first if you haven't checked the list.",
        danger: true,
      },
    },
  ],
  "collection-art": [
    {
      id: "force",
      label: "Force re-render",
      description: "Re-render and re-upload every poster, even ones that haven't changed.",
      overrides: { force: true },
      confirm: {
        title: "Re-render every poster?",
        message:
          "Every opted-in collection's artwork is rendered and uploaded again, replacing any poster changed by hand in Plex.",
      },
    },
  ],
  overlays: [
    {
      id: "remove",
      label: "Remove overlays",
      description: "Restore the original posters instead of applying overlays.",
      overrides: { mode: "remove" },
      confirm: {
        title: "Remove overlays?",
        message: "Every poster this job has overlaid is put back to its original artwork.",
        danger: true,
      },
    },
  ],
  digest: [
    {
      id: "server-only",
      label: "Send server digest only",
      description: "Send the server-wide digest to your channels without emailing portal users.",
      overrides: { includeUserDigests: false },
    },
  ],
};

export function variantFor(command: string, id: string): VariantSpec | undefined {
  return COMMAND_VARIANTS[command]?.find((v) => v.id === id);
}

/** For the drift test. */
export function allVariants(): [string, VariantSpec][] {
  return Object.entries(COMMAND_VARIANTS).flatMap(([command, vs]) =>
    vs.map((v) => [command, v] as [string, VariantSpec]),
  );
}

/**
 * The variants worth offering for a job as it is configured now: ones that
 * would change nothing are left out. "Remove overlays" on the job that only
 * removes overlays, or "Preview" on a sweep already set to preview, would be a
 * menu item that does exactly what the main button does.
 */
export function variantsForJob(jobId: string, command: string, stored: Record<string, unknown>): VariantSpec[] {
  const defaults = Object.fromEntries(
    fieldsFor(command)
      .filter((f) => f.default !== undefined)
      .map((f) => [f.key, f.default]),
  );
  const effective = { ...defaults, ...stored, ...lockedConfigFor(jobId) };
  return (COMMAND_VARIANTS[command] ?? []).filter(
    (v) => !Object.entries(v.overrides).every(([k, value]) => effective[k] === value),
  );
}
