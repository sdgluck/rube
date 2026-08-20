/**
 * Building a bundle.
 *
 * The interesting half is what is deliberately *left out*, and each omission
 * has a failure behind it:
 *
 *  - Run statistics, last-run errors, rating keys. They describe this server's
 *    history with a rule, not the rule.
 *  - Secrets, unless explicitly asked for. See `bundle.ts`.
 *  - Tag keys and section ids, always. They are replaced with names, which is
 *    the whole reason this is a format rather than a `SELECT *`.
 */
import { eq } from "drizzle-orm";
import { jobs, overlayConfigs, overlayPresets, rules, type Db } from "@tinkerbell/db";
import {
  BUNDLE_FORMAT_VERSION,
  translateSmartFilterTags,
  type Bundle,
  type BundlePart,
  type ExportedRule,
  type TagLookup,
  type TagTranslationWarning,
} from "@tinkerbell/contracts";
import {
  createLogger,
  errorMessage,
  NESTED_SECRETS,
  SECRET_KEYS,
  UNLOGGED_CONFIG_KEYS,
  type ConfigKey,
  type ConfigStore,
} from "@tinkerbell/core";

const log = createLogger("portability");

/** Drop one field from an object, leaving the rest of it intact. */
function omitField(entry: unknown, field: string): unknown {
  if (!entry || typeof entry !== "object") return entry;
  const { [field]: _dropped, ...rest } = entry as Record<string, unknown>;
  return rest;
}

/**
 * Config keys an export never carries, whatever the secrets setting says.
 *
 * Two groups. The auth keys decide who may sign in to *this* server, and
 * carrying them into a bundle means either exporting a standing grant or
 * importing one — the first is a credential leak and the second is a privilege
 * escalation with a friendly UI in front of it. Everything in
 * `UNLOGGED_CONFIG_KEYS` is job state or view state: importing a stale
 * `registry_cache` or somebody else's dashboard layout is at best noise, and
 * `migration_pending_plan` would be a plan to act on a library that isn't
 * there.
 */
const NEVER_EXPORTED = new Set<ConfigKey>([
  "admin_auth_enabled",
  "admin_allowed_user_ids",
  "admin_plex_client_id",
  "global_plex_owner_id",
  "global_plex_owner_username",
  "global_plex_owner_token_hash",
  "global_plex_client_id",
  ...UNLOGGED_CONFIG_KEYS,
]);

export interface ExportOptions {
  parts: readonly BundlePart[];
  /**
   * Include credentials. Off by default at every call site, and the reason it
   * is a per-export choice rather than a setting: the answer depends on where
   * the file is going, and a stored preference would silently apply to the
   * next export, which is the one that gets pasted into a forum thread.
   */
  includeSecrets?: boolean;
  server?: { machineId: string; friendlyName: string };
  tinkerbellVersion: string;
}

export interface ExportResult {
  bundle: Bundle;
  /** Tag values that could not be turned into a display name. */
  warnings: (TagTranslationWarning & { ruleName: string })[];
}

export interface ExportDeps {
  db: Db;
  config: ConfigStore;
  /** `client.getFilterFieldValues`, or a stub when Plex isn't reachable. */
  tagLookup: TagLookup;
  sections: () => Array<{ key: string; title: string }>;
}

export function createExport(deps: ExportDeps) {
  const { db, config, tagLookup, sections } = deps;

  /**
   * Turn a rule's per-server tag keys into display names.
   *
   * Best-effort by design. A Plex that is down, a library that has been
   * removed, a tag that no longer exists — none of those should mean no export
   * at all, because the moment somebody most wants their config out is often
   * the moment the server is misbehaving. The untranslated clause travels as
   * the raw key and the warning says so, which is honest and still importable
   * back into the server it came from.
   */
  async function portableRuleConfig(
    rule: typeof rules.$inferSelect,
    warnings: ExportResult["warnings"],
  ): Promise<Record<string, unknown>> {
    const config = { ...rule.config };
    if (rule.type !== "smart_filter" || !config.smartFilter) return config;

    const titles = Array.isArray(config.sections) ? (config.sections as string[]) : [];
    const byTitle = new Map(sections().map((s) => [s.title, s.key]));
    const targets = titles
      .map((title) => ({ sectionTitle: title, sectionId: byTitle.get(title) ?? "" }))
      .filter((t) => t.sectionId !== "");

    if (targets.length === 0) return config;

    try {
      const translated = await translateSmartFilterTags(config.smartFilter, {
        target: targets[0],
        alsoWarnAgainst: targets.slice(1),
        direction: "toTitles",
        lookup: tagLookup,
      });
      config.smartFilter = translated.smartFilter;
      warnings.push(...translated.warnings.map((w) => ({ ...w, ruleName: rule.name })));
    } catch (err) {
      log.warn("could not make a rule's tags portable", { rule: rule.name, err: errorMessage(err) });
    }
    return config;
  }

  async function exportBundle(opts: ExportOptions): Promise<ExportResult> {
    const want = (part: BundlePart) => opts.parts.includes(part);
    const warnings: ExportResult["warnings"] = [];

    const bundle: Bundle = {
      formatVersion: BUNDLE_FORMAT_VERSION,
      exportedAt: Date.now(),
      tinkerbellVersion: opts.tinkerbellVersion,
      server: opts.server,
      containsSecrets: false,
    };

    if (want("rules")) {
      const rows = db.select().from(rules).orderBy(rules.position).all();
      const exported: ExportedRule[] = [];
      for (const row of rows) {
        exported.push({
          id: row.id,
          name: row.name,
          type: row.type,
          enabled: row.enabled === 1,
          position: row.position,
          config: await portableRuleConfig(row, warnings),
          registryRuleSlug: row.registryRuleSlug,
          registryPackSlug: row.registryPackSlug,
          registryVersion: row.registryVersion,
        });
      }
      bundle.rules = exported;
    }

    if (want("jobs")) {
      // Schedules and the on/off switch, never run history. The receiving
      // server's jobs have their own runs, and a bundle carrying somebody
      // else's failed run from March would be answering a question nobody
      // asked while inflating the file.
      bundle.jobs = db
        .select()
        .from(jobs)
        .all()
        .map((row) => ({
          id: row.id,
          name: row.name,
          command: row.command,
          schedule: row.schedule,
          enabled: row.enabled === 1,
          config: (row.config ?? {}) as Record<string, unknown>,
        }));
    }

    if (want("overlayPresets")) {
      // Built-ins ship with the app version, so exporting them means importing
      // a stale copy of something the target already has — and, on an older
      // target, silently downgrading it.
      bundle.overlayPresets = db
        .select()
        .from(overlayPresets)
        .where(eq(overlayPresets.builtIn, 0))
        .all()
        .map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          data: JSON.parse(row.data) as unknown,
        }));
    }

    if (want("overlayConfigs")) {
      const byId = new Map(sections().map((s) => [s.key, s.title]));
      bundle.overlayConfigs = db
        .select()
        .from(overlayConfigs)
        .all()
        // A section this server no longer has is dropped rather than exported
        // under its numeric id: the id would attach the overlay to an
        // arbitrary library on import, which is worse than the overlay being
        // absent and mentioned in the summary.
        .filter((row) => byId.has(row.sectionId))
        .map((row) => ({
          sectionTitle: byId.get(row.sectionId)!,
          position: row.position,
          overlayType: row.overlayType,
          order: row.order,
          style: row.style ? (JSON.parse(row.style) as unknown) : null,
          rule: row.rule ? (JSON.parse(row.rule) as unknown) : null,
        }));
    }

    if (want("config")) {
      const all = config.getAllConfig() as Record<string, unknown>;
      const kept: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(all)) {
        if (NEVER_EXPORTED.has(key as ConfigKey)) continue;
        if (!opts.includeSecrets && SECRET_KEYS.has(key as ConfigKey)) continue;
        kept[key] = value;
      }
      // Nested secrets — `global_llm.apiKey`, every `global_arr_instances[].apiKey`
      // — are not reachable by the top-level skip above, and are exactly where
      // this has gone wrong before. They are *deleted* rather than replaced with
      // the redaction sentinel: the sentinel is a per-process random string that
      // means "keep what you have" to a form on this server, and it means
      // nothing at all in a file being read by a different one tomorrow.
      if (!opts.includeSecrets) {
        for (const { key, field, each } of NESTED_SECRETS) {
          const value = kept[key];
          if (value === undefined || value === null) continue;
          kept[key] = each
            ? Array.isArray(value)
              ? value.map((entry) => omitField(entry, field))
              : value
            : omitField(value, field);
        }
      }
      bundle.config = kept;
      bundle.containsSecrets = opts.includeSecrets === true;
    }

    return { bundle, warnings };
  }

  return { exportBundle };
}
