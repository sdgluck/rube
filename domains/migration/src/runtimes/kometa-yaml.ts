import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import { collections, migrationImports, plexSections, type Db } from "@rube/db";
import { PLAYLIST_CAPABLE_RULE_TYPES, RULE_TYPE_VALUES } from "@rube/contracts";
import {
  buildYamlPlan,
  bundleLoader,
  isYaml,
  readImport,
  type ImportFile,
  type MappedOverlay,
  type MetadataOverride,
} from "@rube/migrate/kometa-yaml";
import type { MigrationPlan } from "@rube/migrate";
import { and, desc, eq } from "drizzle-orm";
import type { BuildPlanInput, ProviderRuntime, ProviderScanResult } from "../runtime.ts";

/**
 * The Kometa YAML importer's server half.
 *
 * Everything impure lives here so `@rube/migrate/kometa-yaml` can stay a
 * pure function of `{path, text}[]` — reading the bundle out of the database,
 * reading a directory off disk when the user points at one, joining Kometa's
 * library names onto real Plex sections, and matching a definition to the
 * collection it built.
 *
 * Note what this runtime deliberately *doesn't* do: scan. It has nothing to
 * count until a user hands it a config, so `scan()` reports zero and the
 * banner stays quiet. The title-scan Kometa provider is what notices a Kometa
 * install exists; this one is what migrates it properly once noticed.
 */

export const KOMETA_YAML_PROVIDER_ID = "kometa-yaml";

/** Ceilings on what a single import may pull in. */
const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export interface KometaYamlDeps {
  db: Db;
  /**
   * Whether reading a config directory off the server's own filesystem is
   * allowed. Off for hosted installs, where the server's disk isn't the
   * user's. Local installs want it on: Kometa and Rube usually share a
   * volume mount, and pointing at `/config` is the closest thing to the
   * one-click migration this whole feature is aiming at.
   */
  allowServerPath?: boolean;
}

export function createKometaYaml(deps: KometaYamlDeps) {
  const { db, allowServerPath = true } = deps;

  /**
   * Read a Kometa config directory (or a single config file) off disk.
   *
   * Only ever called with a path the admin typed into their own Settings page,
   * and it only reads YAML. The traversal is bounded on depth, file count and
   * total bytes rather than trusted to terminate: a symlink loop under
   * `/config` would otherwise hang the request.
   */
  async function readServerPath(path: string): Promise<ImportFile[]> {
    if (!allowServerPath) throw new Error("Reading config from the server's filesystem is disabled on this install.");
    if (!isAbsolute(path)) throw new Error("Use an absolute path, e.g. /config/config.yml.");

    const info = await stat(path).catch(() => null);
    if (!info) throw new Error(`Nothing found at ${path}.`);

    if (info.isFile()) {
      return [{ path: path.split("/").pop() ?? "config.yml", text: await readFile(path, "utf8") }];
    }

    const out: ImportFile[] = [];
    let bytes = 0;
    const seen = new Set<string>();

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 6 || out.length >= MAX_FILES) return;
      // `stat` follows symlinks, so a link back up the tree would recurse
      // forever without this.
      const real = await stat(dir).catch(() => null);
      if (!real) return;
      const id = `${real.dev}:${real.ino}`;
      if (seen.has(id)) return;
      seen.add(id);

      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (out.length >= MAX_FILES) return;
        if (entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
          continue;
        }
        if (!isYaml(entry.name)) continue;
        const text = await readFile(full, "utf8").catch(() => null);
        if (text == null) continue;
        bytes += Buffer.byteLength(text);
        if (bytes > MAX_TOTAL_BYTES) throw new Error("That directory holds more YAML than an import can take.");
        out.push({ path: relative(path, full).replace(/\\/g, "/"), text });
      }
    };

    await walk(path, 0);
    if (out.length === 0) throw new Error(`No YAML files found under ${path}.`);
    return out;
  }

  /** Persist a bundle and return its id. */
  function saveImport(id: string, files: ImportFile[]): void {
    db.insert(migrationImports)
      .values({
        id,
        providerId: KOMETA_YAML_PROVIDER_ID,
        createdAt: Date.now(),
        files,
        diagnostics: [],
        sectionMap: {},
        planCache: null,
      })
      .run();
  }

  function loadImport(importId: string): { files: ImportFile[]; sectionMap: Record<string, string> } | null {
    const row = db
      .select()
      .from(migrationImports)
      .where(and(eq(migrationImports.id, importId), eq(migrationImports.providerId, KOMETA_YAML_PROVIDER_ID)))
      .get();
    return row ? { files: row.files, sectionMap: row.sectionMap } : null;
  }

  function latestImportId(): string | null {
    const row = db
      .select({ id: migrationImports.id })
      .from(migrationImports)
      .where(eq(migrationImports.providerId, KOMETA_YAML_PROVIDER_ID))
      .orderBy(desc(migrationImports.createdAt))
      .get();
    return row?.id ?? null;
  }

  /** Record the user's Kometa-library → Plex-section choices. */
  function setSectionMap(importId: string, sectionMap: Record<string, string>): void {
    db.update(migrationImports)
      // The cached plan was built against the old mapping, so it is wrong the
      // moment the mapping changes.
      .set({ sectionMap, planCache: null })
      .where(eq(migrationImports.id, importId))
      .run();
  }

  /**
   * Kometa library name → Plex section.
   *
   * Kometa keys libraries by Plex section *title*, so an exact title match is
   * right far more often than not — but titles get renamed, and a wrong guess
   * silently builds someone's movie collections in their 4K library. So the
   * match is only ever a *prefill*: the user's explicit choice, once made,
   * always wins.
   */
  function resolveSections(
    libraryNames: string[],
    sectionMap: Record<string, string>,
  ): Map<string, { sectionId: string; sectionTitle: string }> {
    const sections = db.select({ key: plexSections.key, title: plexSections.title }).from(plexSections).all();
    const byId = new Map(sections.map((s) => [s.key, s]));
    const byTitle = new Map(sections.map((s) => [s.title.trim().toLowerCase(), s]));

    const out = new Map<string, { sectionId: string; sectionTitle: string }>();
    for (const name of libraryNames) {
      const chosen = sectionMap[name] ? byId.get(sectionMap[name]!) : undefined;
      const guessed = byTitle.get(name.trim().toLowerCase());
      const section = chosen ?? guessed;
      if (section) out.set(name, { sectionId: section.key, sectionTitle: section.title });
    }
    return out;
  }

  /**
   * Live collections keyed `sectionId::lowercased title`, so a definition can
   * find the collection it produced and offer to replace it.
   */
  function existingCollections(): Map<string, string> {
    const rows = db
      .select({
        ratingKey: collections.plexRatingKey,
        sectionId: collections.sectionId,
        title: collections.title,
      })
      .from(collections)
      .all();
    return new Map(rows.map((r) => [`${r.sectionId}::${r.title.trim().toLowerCase()}`, r.ratingKey]));
  }

  /**
   * The overlay layouts an import would apply, keyed to real Plex sections.
   *
   * Separate from `buildPlan` because overlays aren't rules: they don't appear
   * in the plan's proposed list, aren't individually selectable, and are
   * applied wholesale per library. Folding them into `MigrationPlan` would mean
   * every provider carried a field only one of them can ever populate.
   */
  async function overlaysFor(
    importId: string,
  ): Promise<Array<{ sectionId: string; sectionTitle: string; configs: MappedOverlay[] }>> {
    const stored = loadImport(importId);
    if (!stored) return [];

    const imported = await readImport({ files: stored.files, loader: bundleLoader(stored.files) });
    if (imported.overlays.size === 0) return [];

    const sections = resolveSections([...imported.overlays.keys()], stored.sectionMap);
    const out: Array<{ sectionId: string; sectionTitle: string; configs: MappedOverlay[] }> = [];
    for (const [library, configs] of imported.overlays) {
      const section = sections.get(library);
      // A library the user chose not to migrate has no section, and applying
      // its overlays anywhere would be worse than not applying them.
      if (!section || configs.length === 0) continue;
      out.push({ sectionId: section.sectionId, sectionTitle: section.sectionTitle, configs });
    }
    return out;
  }

  /**
   * Per-item metadata edits an import would store, resolved to Plex sections.
   *
   * Like overlays, these aren't rules and don't belong in the plan's proposed
   * list — they're a body of hand-written text that gets stored once and
   * applied by its own job.
   */
  async function metadataOverridesFor(
    importId: string,
  ): Promise<Array<{ sectionId: string; sectionTitle: string; overrides: MetadataOverride[] }>> {
    const stored = loadImport(importId);
    if (!stored) return [];

    const imported = await readImport({ files: stored.files, loader: bundleLoader(stored.files) });
    if (imported.metadataOverrides.size === 0) return [];

    const sections = resolveSections([...imported.metadataOverrides.keys()], stored.sectionMap);
    const out: Array<{ sectionId: string; sectionTitle: string; overrides: MetadataOverride[] }> = [];
    for (const [library, overrides] of imported.metadataOverrides) {
      const section = sections.get(library);
      if (!section || overrides.length === 0) continue;
      out.push({ sectionId: section.sectionId, sectionTitle: section.sectionTitle, overrides });
    }
    return out;
  }

  async function buildPlanFor(importId: string): Promise<MigrationPlan> {
    const stored = loadImport(importId);
    if (!stored) throw new Error("That import has expired. Upload your Kometa config again.");

    const imported = await readImport({ files: stored.files, loader: bundleLoader(stored.files) });
    const libraryNames = imported.config.libraries.map((l) => l.libraryName ?? l.name);

    return buildYamlPlan(imported, {
      sections: resolveSections(libraryNames, stored.sectionMap),
      supportedRuleTypes: new Set<string>(RULE_TYPE_VALUES),
      playlistCapableRuleTypes: new Set<string>(PLAYLIST_CAPABLE_RULE_TYPES),
      existingCollections: existingCollections(),
    });
  }

  const KOMETA_YAML_RUNTIME: ProviderRuntime = {
    id: KOMETA_YAML_PROVIDER_ID,
    label: "Kometa config",
    // Nothing to count until a config is handed over, so this never runs from
    // the collections-sync hook.
    autoScan: false,
    ingest: { kind: "files", accept: [".yml", ".yaml"] },
    scan(): ProviderScanResult {
      return { count: 0, scannedAt: Date.now(), bySection: [] };
    },
    async buildPlan(input?: BuildPlanInput): Promise<MigrationPlan> {
      const importId = input?.importId ?? latestImportId();
      if (!importId) {
        return {
          proposed: [],
          future: [],
          unmappable: [],
          diagnostics: [{ severity: "info", message: "Upload your Kometa config to see what would be migrated." }],
          totalSourceItems: 0,
        };
      }
      return buildPlanFor(importId);
    },
    // Plans from a config file, not from Plex collection rows — so there is no
    // row for another provider to defer to us over.
    claims(): boolean {
      return false;
    },
  };

  return {
    KOMETA_YAML_RUNTIME,
    overlaysFor,
    metadataOverridesFor,
    readServerPath,
    saveImport,
    loadImport,
    latestImportId,
    setSectionMap,
    resolveSections,
    MAX_FILES,
    MAX_TOTAL_BYTES,
  };
}
