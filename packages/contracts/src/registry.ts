import { z } from "zod";
import { collectLocalLeaves, smartFilterGroupSchema } from "@tinkerbell/plex-smart-filter";
import { isNonPortableField, RULE_TYPE_VALUES } from "./rule-config.ts";
import { presentationConfigSchema, posterUrlError } from "./presentation.ts";

/**
 * Wire format for the public rule registry served from tinkerbell.dev.
 *
 * The registry is static and git-backed: packs are authored as typed TS in
 * `apps/tinkerbell.dev/src/registry/`, built into `dist/registry/index.json`,
 * and fetched by instances over HTTPS. This schema is the contract between
 * those two halves, so it is validated on both sides — at build time (a bad
 * pack fails CI) and at fetch time (a Tinkerbell that predates a format
 * change refuses the payload rather than misreading it).
 */
export const REGISTRY_FORMAT_VERSION = 1;

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slugs are lowercase, digits, and single hyphens");

export const registryRequirementSchema = z.enum(["omdb", "seerr", "tmdb", "llm", "mdblist"]);

/**
 * A rule as published. Deliberately missing everything instance-local:
 * no `id` (regenerated on import), no `config.sections` (the importing user
 * picks target libraries), and no `config.arr` (quality-profile ids and root
 * folder paths mean nothing on another host).
 */
export const registryRuleSchema = z
  .object({
    slug: slugSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    type: z.enum(RULE_TYPE_VALUES),
    config: z.record(z.string(), z.unknown()),
    /**
     * Integrations the importing instance needs for this rule to do anything.
     * Derived from the rule type, but stated explicitly so the import preview
     * can warn without knowing the type table.
     */
    requires: z.array(registryRequirementSchema).default([]),
    /** Library kinds this rule makes sense for; filters the library picker. */
    mediaTypes: z
      .array(z.enum(["movie", "show"]))
      .min(1)
      .default(["movie", "show"]),
  })
  .superRefine((rule, ctx) => {
    // A pack crosses an instance boundary, and some field values simply don't.
    // Tag keys are translated on import; a Plex account id can't be, because it
    // identifies a person rather than a per-server row. Fail the build with the
    // field named, rather than shipping a rule that filters against a stranger.
    // Presentation is the one part of a published config that makes the
    // importing server fetch from a third-party host on a schedule, so it is
    // validated here rather than left to the generic config parse — a build
    // failure names the offending URL, an import-time failure would not.
    if (rule.config?.presentation !== undefined) {
      const presentation = presentationConfigSchema.safeParse(rule.config.presentation);
      if (!presentation.success) {
        ctx.addIssue({
          code: "custom",
          path: ["config", "presentation"],
          message: `invalid presentation config: ${presentation.error.issues.map((i) => i.message).join("; ")}`,
        });
      } else if (presentation.data.posterUrl) {
        const error = posterUrlError(presentation.data.posterUrl);
        if (error) {
          ctx.addIssue({ code: "custom", path: ["config", "presentation", "posterUrl"], message: error });
        }
      }
    }

    const parsed = smartFilterGroupSchema.safeParse(rule.config?.smartFilter);
    if (!parsed.success) return;
    for (const leaf of collectLocalLeaves(parsed.data)) {
      if (!isNonPortableField(leaf.field)) continue;
      ctx.addIssue({
        code: "custom",
        path: ["config", "smartFilter"],
        message: `"${leaf.field}" is not portable between servers — it names a Plex account, which is meaningless on the importing user's server. Remove it before publishing.`,
      });
    }
  });

export const registryPackSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  tagline: z.string().min(1),
  description: z.string().min(1),
  /** Bumped whenever any member rule's config changes. Drives update prompts. */
  version: z.number().int().positive(),
  tags: z.array(z.string()).default([]),
  ruleSlugs: z.array(slugSchema).min(1),
});

export const registryIndexSchema = z.object({
  formatVersion: z.literal(REGISTRY_FORMAT_VERSION),
  generatedAt: z.number(),
  packs: z.array(registryPackSchema),
  rules: z.array(registryRuleSchema),
});

export type RegistryRequirement = z.infer<typeof registryRequirementSchema>;
export type RegistryRule = z.infer<typeof registryRuleSchema>;
export type RegistryPack = z.infer<typeof registryPackSchema>;
export type RegistryIndex = z.infer<typeof registryIndexSchema>;

/** Input shape for authoring — `requires` and `mediaTypes` are optional here
 *  and defaulted by the schema, so pack files stay terse. */
export type RegistryRuleInput = z.input<typeof registryRuleSchema>;
export type RegistryPackInput = z.input<typeof registryPackSchema>;

export const DEFAULT_REGISTRY_URL = "https://tinkerbell.dev/registry/index.json";

/**
 * Per-import tweaks to a pack's published config.
 *
 * Packs ship opinionated defaults — grouped rules build a collection per
 * director/genre/… and rotate ten of them onto the homepage — but those are
 * the author's guesses about somebody else's library. These knobs let
 * the importing user reshape that at the moment of import instead of editing
 * every rule afterwards. Omitted fields keep whatever the pack published.
 *
 * Applied per rule and only where meaningful: `limit` and `minItems` mean
 * nothing to a single-collection rule like a smart filter, and are ignored
 * there rather than silently written into its config.
 */
export const registryImportOverridesSchema = z.object({
  /** `false` unpins everything in the pack; `true` pins the grouped rules. */
  pinToHomepage: z.boolean().optional(),
  /** How many of a grouped rule's collections sit on the homepage at once. */
  pinRotationCount: z.number().int().positive().optional(),
  /** Cap collections per grouped rule. Omitted keeps the pack's setting. */
  limit: z.number().int().positive().optional(),
  /** Smallest group worth a collection, for grouped rules. */
  minItems: z.number().int().positive().optional(),
  /**
   * Smallest collection worth a homepage row. Unlike `minItems` this doesn't
   * decide whether the collection is built — the thin ones are still created,
   * they just don't get promoted — so it applies to every pinned rule in the
   * pack, not only the grouped ones.
   */
  pinMinItems: z.number().int().positive().optional(),
});

export type RegistryImportOverrides = z.infer<typeof registryImportOverridesSchema>;

/** One tag value in a published rule that this server has no equivalent for.
 *  Surfaced in the import preview — the rule still imports, but the user is
 *  told up front that a clause won't match anything. */
export interface ResolutionWarning {
  ruleSlug: string;
  field: string;
  value: string;
  sectionTitle: string;
}

export interface ImportPlanItem {
  rule: RegistryRule;
  /** Config after tag resolution and section injection — what will be written. */
  config: Record<string, unknown>;
  /** Name after collision de-duplication against existing rules. */
  name: string;
  nameCollision: boolean;
  resolutionWarnings: ResolutionWarning[];
  missingRequirements: RegistryRequirement[];
}

export interface ImportPlan {
  packSlug: string | null;
  packVersion: number | null;
  sectionTitles: string[];
  items: ImportPlanItem[];
}

export interface RegistryUpdate {
  ruleId: string;
  ruleName: string;
  ruleSlug: string;
  packSlug: string | null;
  fromVersion: number;
  toVersion: number;
  /** True when the local config no longer hashes to what was imported.
   *  These are reported but never updated automatically — the user's own
   *  edits outrank a registry bump. */
  locallyModified: boolean;
}
