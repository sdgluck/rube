/**
 * The portable bundle: everything you configured, as one JSON document.
 *
 * Tinkerbell's whole state lives in one SQLite file, which makes "send me your
 * rule so I can see what's wrong" and "I'm moving to a new host" equally
 * impossible. This is the format that fixes both, and it is deliberately a
 * document rather than a database dump: a dump is a schema version you have to
 * match, and this has to survive being pasted into an issue by someone running
 * a version older than yours.
 *
 * Two properties decide whether it is useful or a trap, and both are enforced
 * here rather than left to the exporter:
 *
 *  - **Secrets do not travel by default.** An export is something people paste
 *    into gists. `containsSecrets` is on the document so the import side can
 *    warn too, and the exporter only sets it when asked.
 *  - **Server-specific identifiers do not travel at all.** Tag keys leave as
 *    display names and section references leave as titles. See
 *    `portable-rule.ts` — a bundle full of `genre = "5840"` imports cleanly
 *    and matches nothing, which is the worst possible failure mode: silent.
 */
import { z } from "zod";

/**
 * Bumped only for a change an older reader cannot cope with.
 *
 * Adding an optional section is not one of those — a v1 reader ignores keys it
 * doesn't know, which is why every collection below is optional. The import
 * side refuses a *higher* version with a message naming the version needed,
 * rather than parsing what it can and producing half a configuration.
 */
export const BUNDLE_FORMAT_VERSION = 1;

const exportedRuleSchema = z.object({
  /**
   * The exporting server's rule id.
   *
   * Carried for conflict detection on re-import into the same install ("this
   * is that rule, changed") and ignored entirely when importing elsewhere,
   * where a fresh id is minted. It is not a stable cross-server identity and
   * nothing may treat it as one.
   */
  id: z.string(),
  name: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  position: z.number().int(),
  config: z.record(z.string(), z.unknown()),
  /** Set when the rule came from the public registry, so an import can keep the link. */
  registryRuleSlug: z.string().nullable().optional(),
  registryPackSlug: z.string().nullable().optional(),
  registryVersion: z.number().int().nullable().optional(),
});

const exportedJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  schedule: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
});

const exportedPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** `PresetData`, validated by the overlays domain on import rather than here. */
  data: z.unknown(),
});

const exportedOverlayConfigSchema = z.object({
  /**
   * The library this overlay belongs to, by *title*.
   *
   * Section ids are per-server integers, so exporting one would attach the
   * overlay to whatever library happened to be third on the target machine.
   */
  sectionTitle: z.string(),
  position: z.string(),
  overlayType: z.string(),
  order: z.number().int(),
  style: z.unknown().nullable().optional(),
  rule: z.unknown().nullable().optional(),
});

export const bundleSchema = z.object({
  formatVersion: z.number().int().positive(),
  exportedAt: z.number().int(),
  tinkerbellVersion: z.string(),
  /**
   * Which server it came from. Used to tell "restoring my own backup" from
   * "importing someone else's rules", which are different enough that the
   * import preview says which one is happening.
   */
  server: z.object({ machineId: z.string(), friendlyName: z.string() }).optional(),
  /** True only when the exporter was explicitly asked to include credentials. */
  containsSecrets: z.boolean().default(false),
  rules: z.array(exportedRuleSchema).optional(),
  jobs: z.array(exportedJobSchema).optional(),
  overlayPresets: z.array(exportedPresetSchema).optional(),
  overlayConfigs: z.array(exportedOverlayConfigSchema).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type Bundle = z.infer<typeof bundleSchema>;
export type ExportedRule = z.infer<typeof exportedRuleSchema>;
export type ExportedJob = z.infer<typeof exportedJobSchema>;
export type ExportedPreset = z.infer<typeof exportedPresetSchema>;
export type ExportedOverlayConfig = z.infer<typeof exportedOverlayConfigSchema>;

/** What an export may contain. Every part is opt-out in the UI. */
export const BUNDLE_PARTS = ["rules", "jobs", "overlayPresets", "overlayConfigs", "config"] as const;
export type BundlePart = (typeof BUNDLE_PARTS)[number];

/**
 * What importing one item would do.
 *
 * `identical` is separated from `differs` rather than folded into "exists"
 * because the two lead to different decisions: a hundred identical rules are
 * noise to skip in one click, and the three that differ are the entire reason
 * somebody is reading the preview.
 */
export const IMPORT_VERDICTS = ["new", "identical", "differs"] as const;
export type ImportVerdict = (typeof IMPORT_VERDICTS)[number];

/** What to do about a `differs`. `new` items are created; `identical` skipped. */
export const IMPORT_RESOLUTIONS = ["skip", "overwrite", "duplicate"] as const;
export type ImportResolution = (typeof IMPORT_RESOLUTIONS)[number];
