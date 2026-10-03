/**
 * Reading a bundle back.
 *
 * The rule this module exists to enforce: **nothing is written until somebody
 * has seen what would change.** Import is a preview first, always. A one-click
 * apply over an existing configuration is a restore that silently ate three
 * rules somebody wrote last week — and while the change log records the
 * overwrite, a person who did not know it happened will not go looking.
 *
 * So this splits in two. `previewImport` reads, translates and classifies
 * without touching anything; `applyImport` takes that classification plus one
 * decision per differing item and writes.
 */
import { jobs, overlayConfigs, overlayPresets, rules, type Db } from "@tinkerbell/db";
import {
  type Bundle,
  BUNDLE_FORMAT_VERSION,
  bundleSchema,
  type ImportResolution,
  type ImportVerdict,
  isAlwaysOnJob,
  ruleConfigSchema,
  type TagLookup,
  translateSmartFilterTags,
} from "@tinkerbell/contracts";
import { createLogger, errorMessage, runAsActor, type ConfigKey, type ConfigStore } from "@tinkerbell/core";

const log = createLogger("portability");

export type ImportKind = "rule" | "job" | "overlayPreset" | "overlayConfig" | "config";

export interface ImportItem {
  kind: ImportKind;
  /** Stable within one preview, and what a decision refers to. */
  key: string;
  label: string;
  verdict: ImportVerdict;
  /** Which fields differ, for a `differs`. */
  changed?: string[];
  /** Why this item cannot be imported at all — a library that isn't here. */
  blocked?: string;
}

export interface ImportPreview {
  items: ImportItem[];
  tinkerbellVersion: string;
  exportedAt: number;
  /** True when the bundle came from this very server — i.e. a self-restore. */
  sameServer: boolean;
  containsSecrets: boolean;
  /** Tag names in the bundle this server has no key for. */
  unresolvedTags: { ruleName: string; field: string; value: string; sectionTitle: string }[];
  /** Libraries the bundle refers to that don't exist here. */
  missingSections: string[];
}

/** One decision per `differs` item, keyed by `ImportItem.key`. */
export type ImportDecisions = Record<string, ImportResolution>;

export interface ImportSummary {
  created: number;
  overwritten: number;
  duplicated: number;
  skipped: number;
  /** Items that could not be written, with the reason. */
  failed: { key: string; error: string }[];
}

/**
 * The write surfaces this domain borrows rather than reimplements.
 *
 * Every one of them does something beyond the row: `createRule` records a
 * change and assigns a position, `updateJob` validates the cron expression and
 * reschedules the live timer, `savePreset` records a change. Writing the tables
 * directly from here would produce an import whose rules never run on schedule
 * and whose history is missing exactly the entries somebody will want.
 */
export interface ImportWriters {
  createRule: (
    input: {
      name: string;
      type: string;
      config: Record<string, unknown>;
      enabled?: boolean;
      registryRuleSlug?: string | null;
      registryPackSlug?: string | null;
      registryVersion?: number | null;
    },
    origin?: { source: string; action?: "create" | "import" | "restore" },
  ) => { id: string };
  updateRule: (
    id: string,
    updates: { name?: string; enabled?: number; config?: Record<string, unknown> },
    origin?: { source: string; action?: "update" | "import" | "restore" },
  ) => void;
  updateJob: (id: string, updates: { schedule?: string; enabled?: boolean; config?: Record<string, unknown> }) => void;
  savePreset: (input: { id?: string; name: string; description?: string; data: never }) => string;
  addOverlayConfig: (input: {
    sectionId: string;
    position: never;
    overlayType: never;
    style?: never;
    rule?: never;
  }) => unknown;
  updateOverlayConfig: (id: number, patch: { style?: never; rule?: never; overlayType?: never }) => void;
  setConfig: (key: ConfigKey, value: never) => void;
}

export interface ImportDeps {
  db: Db;
  config: ConfigStore;
  tagLookup: TagLookup;
  sections: () => Array<{ key: string; title: string }>;
  writers: ImportWriters;
}

/** Structural equality, key-order independent — same reasoning as the diff in `domains/config-history`. */
function sameValue(a: unknown, b: unknown): boolean {
  const stable = (v: unknown) =>
    JSON.stringify(v, (_k, val: unknown) =>
      val && typeof val === "object" && !Array.isArray(val)
        ? Object.fromEntries(
            Object.keys(val as Record<string, unknown>)
              .sort()
              .map((k) => [k, (val as Record<string, unknown>)[k]]),
          )
        : val,
    );
  return stable(a) === stable(b);
}

function changedPaths(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.filter((k) => !sameValue(before[k], after[k]));
}

export function createImport(deps: ImportDeps) {
  const { db, config, tagLookup, sections, writers } = deps;

  /**
   * Refuse a bundle this version cannot read, and say what would read it.
   *
   * A future `formatVersion` is the one case where doing our best is worse
   * than refusing: parsing the parts we recognise and dropping the rest
   * produces a configuration that looks complete and isn't.
   */
  function parseBundle(raw: unknown): Bundle {
    const parsed = bundleSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`This isn't a Tinkerbell bundle, or it is damaged: ${parsed.error.issues[0]?.message}`);
    }
    if (parsed.data.formatVersion > BUNDLE_FORMAT_VERSION) {
      throw new Error(
        `This bundle is format version ${parsed.data.formatVersion}, and this Tinkerbell reads version ` +
          `${BUNDLE_FORMAT_VERSION}. It was exported by a newer version — update Tinkerbell and try again.`,
      );
    }
    return parsed.data;
  }

  /**
   * Turn a bundle rule's display names back into this server's tag keys.
   *
   * The inverse of the export walk, and the same one `domains/registry` runs
   * over a published pack — which is why the walk itself lives in contracts.
   */
  async function localiseRuleConfig(
    name: string,
    type: string,
    ruleConfig: Record<string, unknown>,
    unresolved: ImportPreview["unresolvedTags"],
  ): Promise<Record<string, unknown>> {
    const next = { ...ruleConfig };
    if (type !== "smart_filter" || !next.smartFilter) return next;

    const byTitle = new Map(sections().map((s) => [s.title, s.key]));
    const targets = (Array.isArray(next.sections) ? (next.sections as string[]) : [])
      .map((title) => ({ sectionTitle: title, sectionId: byTitle.get(title) ?? "" }))
      .filter((t) => t.sectionId !== "");

    if (targets.length === 0) return next;

    try {
      const translated = await translateSmartFilterTags(next.smartFilter, {
        target: targets[0],
        alsoWarnAgainst: targets.slice(1),
        direction: "toKeys",
        lookup: tagLookup,
      });
      next.smartFilter = translated.smartFilter;
      unresolved.push(...translated.warnings.map((w) => ({ ...w, ruleName: name })));
    } catch (err) {
      log.warn("could not localise a rule's tags", { rule: name, err: errorMessage(err) });
    }
    return next;
  }

  /**
   * Everything the apply step needs, computed once during the preview.
   *
   * Held per call rather than recomputed: `applyImport` re-runs the preview so
   * it acts on a fresh classification (the database may have moved since the
   * user opened the dialogue), and the translated configs are the expensive
   * part — one Plex round trip per section and field.
   */
  interface Prepared {
    preview: ImportPreview;
    bundle: Bundle;
    localisedRules: Map<string, Record<string, unknown>>;
  }

  async function prepare(raw: unknown, localMachineId?: string): Promise<Prepared> {
    const bundle = parseBundle(raw);
    const items: ImportItem[] = [];
    const unresolvedTags: ImportPreview["unresolvedTags"] = [];
    const localisedRules = new Map<string, Record<string, unknown>>();
    const sectionList = sections();
    const localTitles = new Set(sectionList.map((s) => s.title));
    const missingSections = new Set<string>();

    // Rules are matched by name, not by the exported id. An id only means
    // something on the server that minted it, so matching on it would mean
    // re-importing your own backup onto a rebuilt install duplicates every
    // rule. The name is also what the conflict question is really about: "you
    // already have a rule called this".
    const rulesByName = new Map(
      db
        .select()
        .from(rules)
        .all()
        .map((r) => [r.name, r] as const),
    );

    for (const rule of bundle.rules ?? []) {
      for (const title of (rule.config.sections as string[] | undefined) ?? []) {
        if (!localTitles.has(title)) missingSections.add(title);
      }
      const localised = await localiseRuleConfig(rule.name, rule.type, rule.config, unresolvedTags);
      localisedRules.set(rule.name, localised);

      // Validated here, not at the moment of writing. A bundle is a file from
      // outside this install — hand-edited, from a newer version, or simply
      // hostile — and a rule whose config the engine can't parse would
      // otherwise be stored and then fail every night at 1am in a job log.
      // Refusing it in the preview puts the message in front of the person who
      // chose the file.
      const invalid = ruleConfigSchema.safeParse(localised);
      const existing = rulesByName.get(rule.name);
      items.push({
        kind: "rule",
        key: `rule:${rule.name}`,
        label: rule.name,
        blocked: invalid.success
          ? undefined
          : `This rule's settings aren't valid: ${invalid.error.issues
              .map((i) => `${i.path.join(".")} ${i.message}`)
              .join("; ")}`,
        verdict: !existing
          ? "new"
          : sameValue(existing.config, localised) && existing.enabled === (rule.enabled ? 1 : 0)
            ? "identical"
            : "differs",
        changed: existing ? changedPaths(existing.config, localised) : undefined,
      });
    }

    const jobsById = new Map(
      db
        .select()
        .from(jobs)
        .all()
        .map((j) => [j.id, j] as const),
    );
    for (const job of bundle.jobs ?? []) {
      const existing = jobsById.get(job.id);
      const before = existing ? { schedule: existing.schedule, enabled: existing.enabled === 1 } : null;
      const after = { schedule: job.schedule, enabled: job.enabled };
      items.push({
        kind: "job",
        key: `job:${job.id}`,
        label: job.name,
        verdict: !before ? "new" : sameValue(before, after) ? "identical" : "differs",
        changed: before ? changedPaths(before, after) : undefined,
        // Jobs are seeded from `DEFAULT_JOBS`, and a row's `command` has to be
        // one this build knows. Creating a row for an unknown command would
        // produce a job that fails every night with "Unknown command", so a
        // job that isn't already here is reported rather than invented.
        blocked: existing ? undefined : "This build has no job with that id — the bundle may be from a newer version.",
      });
    }

    const presetsById = new Map(
      db
        .select()
        .from(overlayPresets)
        .all()
        .map((p) => [p.id, p] as const),
    );
    for (const preset of bundle.overlayPresets ?? []) {
      const existing = presetsById.get(preset.id);
      items.push({
        kind: "overlayPreset",
        key: `overlayPreset:${preset.id}`,
        label: preset.name,
        verdict: !existing
          ? "new"
          : existing.name === preset.name && sameValue(JSON.parse(existing.data), preset.data)
            ? "identical"
            : "differs",
        blocked: existing?.builtIn === 1 ? "This is a built-in preset, and ships with the app." : undefined,
      });
    }

    const overlayRows = db.select().from(overlayConfigs).all();
    for (const overlay of bundle.overlayConfigs ?? []) {
      if (!localTitles.has(overlay.sectionTitle)) missingSections.add(overlay.sectionTitle);
      const sectionId = sectionList.find((s) => s.title === overlay.sectionTitle)?.key;
      const existing = sectionId
        ? overlayRows.find(
            (o) => o.sectionId === sectionId && o.position === overlay.position && o.order === overlay.order,
          )
        : undefined;
      items.push({
        kind: "overlayConfig",
        key: `overlayConfig:${overlay.sectionTitle}:${overlay.position}:${overlay.order}`,
        label: `${overlay.overlayType} on ${overlay.sectionTitle} (${overlay.position})`,
        verdict: !existing
          ? "new"
          : existing.overlayType === overlay.overlayType &&
              sameValue(existing.style ? JSON.parse(existing.style) : null, overlay.style ?? null) &&
              sameValue(existing.rule ? JSON.parse(existing.rule) : null, overlay.rule ?? null)
            ? "identical"
            : "differs",
        blocked: sectionId ? undefined : `This server has no library called “${overlay.sectionTitle}”.`,
      });
    }

    for (const [key, value] of Object.entries(bundle.config ?? {})) {
      const current = config.getConfig(key as ConfigKey);
      items.push({
        kind: "config",
        key: `config:${key}`,
        label: key,
        verdict: current === undefined ? "new" : sameValue(current, value) ? "identical" : "differs",
      });
    }

    return {
      bundle,
      localisedRules,
      preview: {
        items,
        tinkerbellVersion: bundle.tinkerbellVersion,
        exportedAt: bundle.exportedAt,
        sameServer: !!bundle.server && !!localMachineId && bundle.server.machineId === localMachineId,
        containsSecrets: bundle.containsSecrets,
        unresolvedTags,
        missingSections: [...missingSections],
      },
    };
  }

  async function previewImport(raw: unknown, localMachineId?: string): Promise<ImportPreview> {
    return (await prepare(raw, localMachineId)).preview;
  }

  /**
   * Write the bundle, according to `decisions`.
   *
   * The classification is recomputed here rather than carried over from the
   * preview the user looked at. Between opening the dialogue and pressing the
   * button a nightly run may have edited a rule, and applying a stale
   * "identical" would silently overwrite it. Recomputing means the decisions
   * are applied to what is true now, and an item that has since become
   * identical is skipped rather than rewritten.
   */
  async function applyImport(
    raw: unknown,
    decisions: ImportDecisions,
    opts: { localMachineId?: string } = {},
  ): Promise<ImportSummary> {
    const { bundle, preview, localisedRules } = await prepare(raw, opts.localMachineId);
    const summary: ImportSummary = { created: 0, overwritten: 0, duplicated: 0, skipped: 0, failed: [] };
    const byKey = new Map(preview.items.map((i) => [i.key, i] as const));

    /** `skip` unless the user said otherwise — the safe answer is the default. */
    const decide = (key: string): ImportResolution => decisions[key] ?? "skip";

    // Everything written here is attributed to the import rather than to the
    // admin who uploaded the file, so a forty-rule bundle reads as one import
    // in the history instead of forty hand edits.
    return runAsActor({ source: "import", username: "" }, async () => {
      const rulesByName = new Map(
        db
          .select()
          .from(rules)
          .all()
          .map((r) => [r.name, r] as const),
      );

      for (const rule of bundle.rules ?? []) {
        const item = byKey.get(`rule:${rule.name}`);
        if (!item) continue;
        // Counted, not dropped. A summary whose numbers don't add up to the
        // bundle's contents is one that hides the item somebody most wants to
        // hear about.
        if (item.blocked) {
          summary.skipped++;
          continue;
        }
        const localised = localisedRules.get(rule.name) ?? rule.config;
        try {
          if (item.verdict === "identical") {
            summary.skipped++;
          } else if (item.verdict === "new") {
            writers.createRule(
              {
                name: rule.name,
                type: rule.type,
                config: localised,
                enabled: rule.enabled,
                registryRuleSlug: rule.registryRuleSlug ?? null,
                registryPackSlug: rule.registryPackSlug ?? null,
                registryVersion: rule.registryVersion ?? null,
              },
              { source: "import", action: "import" },
            );
            summary.created++;
          } else {
            const resolution = decide(item.key);
            const existing = rulesByName.get(rule.name);
            if (resolution === "overwrite" && existing) {
              writers.updateRule(
                existing.id,
                { name: rule.name, enabled: rule.enabled ? 1 : 0, config: localised },
                { source: "import", action: "import" },
              );
              summary.overwritten++;
            } else if (resolution === "duplicate") {
              writers.createRule(
                {
                  name: uniqueName(rule.name, rulesByName),
                  type: rule.type,
                  config: localised,
                  enabled: rule.enabled,
                },
                { source: "import", action: "import" },
              );
              summary.duplicated++;
            } else {
              summary.skipped++;
            }
          }
        } catch (err) {
          // One bad rule must not abandon the other thirty-nine. The rule that
          // failed is named in the summary, which is what lets somebody fix it
          // and re-import just that one.
          summary.failed.push({ key: item.key, error: errorMessage(err) });
        }
      }

      for (const job of bundle.jobs ?? []) {
        const item = byKey.get(`job:${job.id}`);
        if (!item) continue;
        if (item.blocked) {
          summary.skipped++;
          continue;
        }
        if (item.verdict === "identical" || decide(item.key) === "skip") {
          summary.skipped++;
          continue;
        }
        try {
          // An always-on job can't be switched off, and an older bundle may
          // carry `enabled: false` for one from before that was enforced.
          // Dropping the flag keeps the rest of the job's settings importable
          // rather than failing the whole item on a field that has no effect.
          writers.updateJob(job.id, {
            schedule: job.schedule,
            enabled: isAlwaysOnJob(job.id) ? undefined : job.enabled,
            config: job.config,
          });
          summary.overwritten++;
        } catch (err) {
          summary.failed.push({ key: item.key, error: errorMessage(err) });
        }
      }

      for (const preset of bundle.overlayPresets ?? []) {
        const item = byKey.get(`overlayPreset:${preset.id}`);
        if (!item) continue;
        if (item.blocked) {
          summary.skipped++;
          continue;
        }
        if (item.verdict === "identical") {
          summary.skipped++;
          continue;
        }
        if (item.verdict === "differs" && decide(item.key) === "skip") {
          summary.skipped++;
          continue;
        }
        try {
          const duplicating = item.verdict === "differs" && decide(item.key) === "duplicate";
          writers.savePreset({
            // A duplicate gets no id, so `savePreset` mints one rather than
            // overwriting the preset it was meant to sit beside.
            id: duplicating ? undefined : preset.id,
            name: duplicating ? `${preset.name} (imported)` : preset.name,
            description: preset.description,
            data: preset.data as never,
          });
          if (item.verdict === "new") summary.created++;
          else if (duplicating) summary.duplicated++;
          else summary.overwritten++;
        } catch (err) {
          summary.failed.push({ key: item.key, error: errorMessage(err) });
        }
      }

      const sectionList = sections();
      const overlayRows = db.select().from(overlayConfigs).all();
      for (const overlay of bundle.overlayConfigs ?? []) {
        const key = `overlayConfig:${overlay.sectionTitle}:${overlay.position}:${overlay.order}`;
        const item = byKey.get(key);
        if (!item) continue;
        if (item.blocked) {
          summary.skipped++;
          continue;
        }
        if (item.verdict === "identical" || (item.verdict === "differs" && decide(key) === "skip")) {
          summary.skipped++;
          continue;
        }
        const sectionId = sectionList.find((s) => s.title === overlay.sectionTitle)?.key;
        if (!sectionId) continue;
        try {
          const existing = overlayRows.find(
            (o) => o.sectionId === sectionId && o.position === overlay.position && o.order === overlay.order,
          );
          if (existing) {
            writers.updateOverlayConfig(existing.id, {
              overlayType: overlay.overlayType as never,
              style: (overlay.style ?? null) as never,
              rule: (overlay.rule ?? null) as never,
            });
            summary.overwritten++;
          } else {
            writers.addOverlayConfig({
              sectionId,
              position: overlay.position as never,
              overlayType: overlay.overlayType as never,
              style: (overlay.style ?? null) as never,
              rule: (overlay.rule ?? null) as never,
            });
            summary.created++;
          }
        } catch (err) {
          summary.failed.push({ key, error: errorMessage(err) });
        }
      }

      for (const [configKey, value] of Object.entries(bundle.config ?? {})) {
        const item = byKey.get(`config:${configKey}`);
        if (!item) continue;
        if (item.verdict === "identical" || (item.verdict === "differs" && decide(item.key) !== "overwrite")) {
          summary.skipped++;
          continue;
        }
        try {
          // Through `setConfig`, so the value is schema-checked on the next
          // read and the write lands in the change log like any other.
          writers.setConfig(configKey as ConfigKey, value as never);
          if (item.verdict === "new") summary.created++;
          else summary.overwritten++;
        } catch (err) {
          summary.failed.push({ key: item.key, error: errorMessage(err) });
        }
      }

      return summary;
    });
  }

  /** "Sci-Fi Gems" → "Sci-Fi Gems (imported)" → "Sci-Fi Gems (imported 2)". */
  function uniqueName(base: string, taken: Map<string, unknown>): string {
    let candidate = `${base} (imported)`;
    let n = 2;
    while (taken.has(candidate)) candidate = `${base} (imported ${n++})`;
    return candidate;
  }

  return { parseBundle, previewImport, applyImport };
}
