import { asList, asRecord, parseYamlFile, type ParsedFile } from "./parse.ts";
import type { KometaConfig, KometaFileRef, KometaLibrary } from "./types.ts";
import type { PlanDiagnostic } from "../types.ts";

/**
 * Read `config.yml` into the shape the rest of the importer works from.
 *
 * The job is narrower than it looks: pull out the libraries, the file
 * references hanging off each of them, and enough of `settings` to resolve a
 * `repo:` reference later. Everything else in a Kometa config is either
 * credentials (which we deliberately do not read past noting *that* an
 * integration was configured) or run-behaviour knobs with no Rube
 * counterpart.
 */

/** The keys under a library that point at other files, and where they land. */
const FILE_LIST_KEYS = [
  { key: "collection_files", target: "collectionFiles" },
  { key: "overlay_files", target: "overlayFiles" },
  { key: "metadata_files", target: "metadataFiles" },
  // Kometa renamed these; older configs in the wild still use the old spelling.
  { key: "metadata_path", target: "collectionFiles" },
  { key: "overlay_path", target: "overlayFiles" },
] as const;

/** `settings` keys that mean "this integration had credentials". */
const INTEGRATION_KEYS = [
  "tmdb",
  "trakt",
  "mdblist",
  "imdb",
  "omdb",
  "radarr",
  "sonarr",
  "tautulli",
  "notifiarr",
  "anidb",
  "mal",
  "letterboxd",
];

function refFrom(entry: unknown, line: number | undefined): KometaFileRef | null {
  // Kometa also accepts a bare string, meaning `file:`.
  if (typeof entry === "string") return { kind: "file", value: entry, line };

  const rec = asRecord(entry);
  if (!rec) return null;

  for (const kind of ["default", "file", "folder", "git", "repo", "url"] as const) {
    const value = rec[kind];
    if (typeof value === "string" && value.trim().length > 0) {
      return { kind, value: value.trim(), line };
    }
  }
  return null;
}

/**
 * Template variables can sit on the file reference itself (`- default: genre`
 * with `template_variables:` beneath it). They're the main way a defaults user
 * customises anything, so they travel with the reference.
 */
export function templateVarsOf(entry: unknown): Record<string, unknown> {
  const rec = asRecord(entry);
  return rec ? (asRecord(rec.template_variables) ?? {}) : {};
}

export interface ReadConfigResult {
  config: KometaConfig;
  diagnostics: PlanDiagnostic[];
  /** Template variables per file reference, keyed by `kind:value`. */
  refVars: Map<string, Record<string, unknown>>;
  parsed: ParsedFile;
}

export function refKey(ref: KometaFileRef): string {
  return `${ref.kind}:${ref.value}`;
}

export function readConfig(path: string, text: string): ReadConfigResult {
  const parsed = parseYamlFile(path, text);
  const diagnostics = [...parsed.diagnostics];
  const refVars = new Map<string, Record<string, unknown>>();

  const empty: KometaConfig = {
    libraries: [],
    playlistFiles: [],
    settings: {},
    configuredIntegrations: [],
    operations: {},
  };

  const root = asRecord(parsed.value);
  if (!root) {
    if (parsed.value != null) {
      diagnostics.push({
        severity: "error",
        file: path,
        message: "config.yml doesn't look like a Kometa config — expected a mapping at the top level.",
      });
    }
    return { config: empty, diagnostics, refVars, parsed };
  }

  const settings = asRecord(root.settings) ?? {};
  const configuredIntegrations = INTEGRATION_KEYS.filter((k) => asRecord(root[k]) != null);

  const librariesRaw = asRecord(root.libraries);
  if (!librariesRaw) {
    diagnostics.push({
      severity: "error",
      file: path,
      message: "No `libraries:` block found — without it there's nothing to migrate.",
    });
  }

  const libraries: KometaLibrary[] = [];
  const operations: Record<string, Record<string, unknown>> = {};

  for (const [name, rawLib] of Object.entries(librariesRaw ?? {})) {
    const lib = asRecord(rawLib);
    if (!lib) {
      diagnostics.push({
        severity: "warn",
        file: path,
        line: parsed.lineOf(["libraries", name]),
        message: `Library "${name}" isn't a mapping — skipped.`,
      });
      continue;
    }

    const entry: KometaLibrary = {
      name,
      libraryName: typeof lib.library_name === "string" ? lib.library_name : undefined,
      collectionFiles: [],
      overlayFiles: [],
      metadataFiles: [],
      templateVariables: asRecord(lib.template_variables) ?? {},
      line: parsed.lineOf(["libraries", name]),
    };

    for (const { key, target } of FILE_LIST_KEYS) {
      const items = asList(lib[key]);
      items.forEach((item, i) => {
        const line = parsed.lineOf(["libraries", name, key, i]);
        const ref = refFrom(item, line);
        if (!ref) {
          diagnostics.push({
            severity: "warn",
            file: path,
            line,
            message: `Unrecognised ${key} entry in library "${name}" — skipped.`,
          });
          return;
        }
        entry[target].push(ref);
        const vars = templateVarsOf(item);
        if (Object.keys(vars).length > 0) refVars.set(refKey(ref), vars);
      });
    }

    const ops = asRecord(lib.operations);
    if (ops) operations[name] = ops;

    libraries.push(entry);
  }

  // Playlists live at the top level, not under a library — Plex playlists are
  // server-scoped, so Kometa builds them once across every library.
  const playlistFiles: KometaFileRef[] = [];
  asList(root.playlist_files).forEach((item, i) => {
    const ref = refFrom(item, parsed.lineOf(["playlist_files", i]));
    if (ref) playlistFiles.push(ref);
  });

  return {
    config: { libraries, playlistFiles, settings, configuredIntegrations, operations },
    diagnostics,
    refVars,
    parsed,
  };
}
