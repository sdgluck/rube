import { mapDefinition, type MappedDefinition } from "./builders.ts";
import { resolveDefault } from "./defaults.ts";
import { refKey } from "./config.ts";
import type { KometaImport } from "./types.ts";
import type { MigrationPlan, PlanItem, PlanWarning, UnmappableEntry } from "../types.ts";

/**
 * Turn a read Kometa config into a migration plan.
 *
 * One rule per definition, which is the whole reason the YAML path exists —
 * the title-scan importer collapses a hundred collections into eighteen
 * bucket rules because a name is all it has to go on. Here a definition is a
 * definition, and a user recognises their own config on the review screen.
 *
 * Two joins happen at this level rather than in the mapping table, because
 * both need the whole plan in view: matching Kometa's libraries onto Plex
 * sections, and matching a definition onto the live collection it built (so
 * "delete originals" has something to delete).
 */

export interface YamlPlanOptions {
  /**
   * Rule types that can build a playlist. Injected for the same reason
   * `supportedRuleTypes` is: the pure package shouldn't have to track which
   * selections the server considers single-output.
   */
  playlistCapableRuleTypes?: Set<string>;
  /** Kometa library name → Plex section. Built by the user in the Resolve step. */
  sections: Map<string, { sectionId: string; sectionTitle: string }>;
  /** Rule types this server can actually run — anything else becomes unmappable. */
  supportedRuleTypes: Set<string>;
  /**
   * Live Plex collections, for matching a definition to the collection it
   * produced. Keyed by `sectionId::lowercased title`.
   */
  existingCollections?: Map<string, string>;
}

/** `settings.asset_directory`, which Kometa accepts as a string or a list. */
export function kometaAssetDirectory(imported: KometaImport): string | null {
  const raw = imported.config.settings.asset_directory;
  const first = Array.isArray(raw) ? raw[0] : raw;
  const value = typeof first === "string" ? first.trim() : "";
  return value.length > 0 ? value : null;
}

/** Stable per-definition key: same import, same preview, same checkbox state. */
function definitionKey(file: string, libraryName: string, mappingName: string): string {
  return `yaml::${file}::${libraryName}::${mappingName}`;
}

export function buildYamlPlan(imported: KometaImport, opts: YamlPlanOptions): MigrationPlan {
  const { sections, supportedRuleTypes, existingCollections } = opts;
  const playlistCapableRuleTypes = opts.playlistCapableRuleTypes ?? new Set<string>();
  const assetDirectory = kometaAssetDirectory(imported);
  const proposed: PlanItem[] = [];
  const unmappable: UnmappableEntry[] = [];
  const diagnostics = [...imported.diagnostics];

  // ─── Definitions from collection files ─────────────────────────────────

  for (const def of imported.definitions) {
    const section = sections.get(def.libraryName);
    if (!section) {
      unmappable.push({
        ratingKey: "",
        title: def.collectionName,
        sectionId: "",
        sectionTitle: def.libraryName,
        reason: `Kometa library "${def.libraryName}" isn't mapped to a Plex library.`,
        file: def.file,
        line: def.line,
      });
      continue;
    }

    const mapped = mapDefinition(def, { hasAssetDirectory: assetDirectory != null });
    if ("reason" in mapped) {
      unmappable.push({
        ratingKey: matchExisting(existingCollections, section.sectionId, def.collectionName) ?? "",
        title: def.collectionName,
        sectionId: section.sectionId,
        sectionTitle: section.sectionTitle,
        reason: mapped.reason,
        builders: mapped.builders,
        file: def.file,
        line: def.line,
      });
      continue;
    }

    if (!supportedRuleTypes.has(mapped.ruleType)) {
      unmappable.push({
        ratingKey: matchExisting(existingCollections, section.sectionId, def.collectionName) ?? "",
        title: def.collectionName,
        sectionId: section.sectionId,
        sectionTitle: section.sectionTitle,
        reason: `This server can't run \`${mapped.ruleType}\` rules yet.`,
        builders: Object.keys(def.builders),
        file: def.file,
        line: def.line,
      });
      continue;
    }

    const ratingKey = matchExisting(existingCollections, section.sectionId, def.collectionName);
    proposed.push(
      toPlanItem({
        key: definitionKey(def.file, def.libraryName, def.mappingName),
        ruleName: def.collectionName,
        section,
        mapped,
        origin: {
          kind: "yaml",
          file: def.file,
          line: def.line,
          definition: def.mappingName,
          builders: Object.keys(def.builders),
        },
        sampleNames: [def.collectionName],
        ratingKey,
      }),
    );
  }

  // ─── Playlists ─────────────────────────────────────────────────────────
  //
  // A Kometa playlist is a definition like any other — same builders, same
  // filters — differing only in what it produces. So it goes through the same
  // mapping table and comes out as a rule whose action is `playlist`.
  //
  // Playlists aren't library-scoped, so they're planned against whichever
  // section the user mapped first rather than per library. The rule itself
  // combines sections, so the choice only decides which library the rule reads.
  const firstSection = [...sections.values()][0];
  for (const def of imported.playlistDefinitions) {
    if (!firstSection) break;

    const mapped = mapDefinition(def, { hasAssetDirectory: assetDirectory != null });
    if ("reason" in mapped) {
      unmappable.push({
        ratingKey: "",
        title: def.collectionName,
        sectionId: firstSection.sectionId,
        sectionTitle: firstSection.sectionTitle,
        reason: mapped.reason,
        builders: mapped.builders,
        file: def.file,
        line: def.line,
      });
      continue;
    }

    if (!supportedRuleTypes.has(mapped.ruleType) || !playlistCapableRuleTypes.has(mapped.ruleType)) {
      unmappable.push({
        ratingKey: "",
        title: def.collectionName,
        sectionId: firstSection.sectionId,
        sectionTitle: firstSection.sectionTitle,
        reason: playlistCapableRuleTypes.has(mapped.ruleType)
          ? `This server can't run \`${mapped.ruleType}\` rules yet.`
          : `A \`${mapped.ruleType}\` rule builds one collection per group, so it can't become a single playlist.`,
        builders: Object.keys(def.builders),
        file: def.file,
        line: def.line,
      });
      continue;
    }

    proposed.push(
      toPlanItem({
        key: `yaml::playlist::${def.file}::${def.mappingName}`,
        ruleName: def.collectionName,
        section: firstSection,
        mapped: {
          ...mapped,
          ruleConfig: {
            ...mapped.ruleConfig,
            // The name has to live on the action: the rule's own name is what
            // the user sees in the rules list, and they'll rename it.
            action: { kind: "playlist", playlistName: def.collectionName, combineSections: true },
          },
        },
        origin: {
          kind: "yaml",
          file: def.file,
          line: def.line,
          definition: def.mappingName,
          builders: Object.keys(def.builders),
        },
        sampleNames: [def.collectionName],
        ratingKey: undefined,
      }),
    );
  }

  // ─── `default:` entries ────────────────────────────────────────────────
  //
  // These never became definitions — there was no file to read — so they're
  // resolved straight from the defaults table against the library that
  // referenced them.

  for (const library of imported.config.libraries) {
    const section = sections.get(library.libraryName ?? library.name);
    const seenRuleTypes = new Set<string>();

    for (const ref of library.collectionFiles) {
      if (ref.kind !== "default") continue;

      if (!section) {
        unmappable.push({
          ratingKey: "",
          title: `default: ${ref.value}`,
          sectionId: "",
          sectionTitle: library.name,
          reason: `Kometa library "${library.name}" isn't mapped to a Plex library.`,
          line: ref.line,
        });
        continue;
      }

      const vars = imported.refVars.get(refKey(ref)) ?? {};
      const resolved = resolveDefault(ref.value, { ...library.templateVariables, ...vars });

      if (resolved == null) {
        unmappable.push({
          ratingKey: "",
          title: `default: ${ref.value}`,
          sectionId: section.sectionId,
          sectionTitle: section.sectionTitle,
          reason: `Tinkerbell doesn't recognise the Kometa default "${ref.value}".`,
          line: ref.line,
        });
        continue;
      }

      if ("skipped" in resolved) {
        diagnostics.push({ severity: "info", line: ref.line, message: `default: ${ref.value} — ${resolved.skipped}` });
        continue;
      }

      if ("unsupported" in resolved) {
        unmappable.push({
          ratingKey: "",
          title: `default: ${ref.value}`,
          sectionId: section.sectionId,
          sectionTitle: section.sectionTitle,
          reason: resolved.unsupported,
          line: ref.line,
        });
        continue;
      }

      if (!supportedRuleTypes.has(resolved.ruleType)) {
        unmappable.push({
          ratingKey: "",
          title: `default: ${ref.value}`,
          sectionId: section.sectionId,
          sectionTitle: section.sectionTitle,
          reason: `This server can't run \`${resolved.ruleType}\` rules yet.`,
          line: ref.line,
        });
        continue;
      }

      // Several award defaults collapse onto one `awards` rule. Creating one
      // per file would leave the user with five identical rules fighting over
      // the same collections.
      if (seenRuleTypes.has(resolved.ruleType)) {
        diagnostics.push({
          severity: "info",
          line: ref.line,
          message: `default: ${ref.value} — already covered by another rule for this library.`,
        });
        continue;
      }
      seenRuleTypes.add(resolved.ruleType);

      proposed.push(
        toPlanItem({
          key: `yaml::default::${library.name}::${ref.value}`,
          ruleName: `${resolved.label} — ${section.sectionTitle}`,
          section,
          mapped: {
            ruleType: resolved.ruleType,
            ruleConfig: resolved.ruleConfig,
            confidence: resolved.confidence,
            warnings: resolved.warnings,
          },
          origin: { kind: "yaml", line: ref.line, definition: `default: ${ref.value}` },
          sampleNames: [],
          ratingKey: undefined,
        }),
      );
    }
  }

  if (assetDirectory) {
    diagnostics.push({
      severity: "info",
      message: `Your config points at an asset directory (${assetDirectory}). Migrated rules will read collection artwork from it — set the same path in Settings → Appearance so Tinkerbell can find it.`,
    });
  }

  proposed.sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle) || a.ruleName.localeCompare(b.ruleName));
  unmappable.sort((a, b) => a.sectionTitle.localeCompare(b.sectionTitle) || a.title.localeCompare(b.title));

  return {
    proposed,
    // The YAML path has no "recognised but unsupported bucket" middle ground —
    // a definition either maps or is reported with the reason it didn't.
    future: [],
    unmappable,
    diagnostics,
    totalSourceItems: proposed.length + unmappable.length,
  };
}

function toPlanItem(args: {
  key: string;
  ruleName: string;
  section: { sectionId: string; sectionTitle: string };
  mapped: MappedDefinition;
  origin: PlanItem["origin"];
  sampleNames: string[];
  ratingKey: string | undefined;
}): PlanItem {
  const { key, ruleName, section, mapped, origin, sampleNames, ratingKey } = args;

  const warnings: PlanWarning[] = [...mapped.warnings];
  if (mapped.forceDisabled) {
    warnings.push({
      code: "schedule-never",
      message: "Kometa was set never to build this collection, so the rule was created switched off.",
    });
  }

  return {
    key,
    ruleType: mapped.ruleType,
    ruleName,
    sectionId: section.sectionId,
    sectionTitle: section.sectionTitle,
    ruleConfig: { ...mapped.ruleConfig, sections: [section.sectionTitle] },
    enabled: mapped.forceDisabled ? false : undefined,
    confidence: mapped.confidence,
    warnings,
    origin,
    sampleNames,
    replacesCount: ratingKey ? 1 : 0,
    replacesRatingKeys: ratingKey ? [ratingKey] : [],
  };
}

/**
 * Find the Plex collection a definition built, so it can be replaced.
 *
 * Matching on name is the only join available — Kometa leaves no id behind —
 * and it is scoped to the section so two libraries with a "Top 250" don't
 * cross-match. A miss is fine and common: a definition that was never built,
 * or was renamed in Plex afterwards, simply has nothing to delete.
 */
function matchExisting(
  existing: Map<string, string> | undefined,
  sectionId: string,
  title: string,
): string | undefined {
  return existing?.get(`${sectionId}::${title.trim().toLowerCase()}`);
}
