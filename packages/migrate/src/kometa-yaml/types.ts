import type { PlanDiagnostic } from "../types.ts";
import type { MappedOverlay } from "./overlays.ts";
import type { MetadataOverride } from "./metadata.ts";

/**
 * The Kometa config format, as much of it as the importer needs to see.
 *
 * These types describe Kometa's *input*, not Rube's output. They stay
 * deliberately loose — `unknown` rather than a modelled union — anywhere the
 * real format is open-ended, because Kometa accepts a great deal that we only
 * need to recognise well enough to report on. Guessing a tighter shape than
 * the format actually has would turn "a builder we don't support" into a parse
 * error, and the whole design here is that an unmappable definition is a
 * reportable outcome rather than a failure.
 */

/** One file the user handed us, path as their picker reported it. */
export interface ImportFile {
  path: string;
  text: string;
}

/**
 * A reference to another file from `config.yml`. Kometa spells these five
 * ways and resolution differs per kind, so the kind is preserved rather than
 * flattened to a string.
 */
export type KometaFileRef =
  /** `- default: genre` — resolved from our own defaults table, not fetched. */
  | { kind: "default"; value: string; line?: number }
  /** `- file: config/movies.yml` — looked up in the uploaded bundle. */
  | { kind: "file"; value: string; line?: number }
  /** `- folder: config/collections` — every YAML file beneath it. */
  | { kind: "folder"; value: string; line?: number }
  /** `- git: user/repo/file` — Kometa's Community-Configs shorthand. */
  | { kind: "git"; value: string; line?: number }
  /** `- repo: file` — resolved against `settings.custom_repo`. */
  | { kind: "repo"; value: string; line?: number }
  /** `- url: https://…` — fetched verbatim. */
  | { kind: "url"; value: string; line?: number };

/** How a `KometaFileRef` was (or wasn't) turned into text. */
export type RefResolution =
  | { status: "resolved"; ref: KometaFileRef; files: ImportFile[] }
  /** A `default:` entry — no text to load, handled by the defaults table. */
  | { status: "default"; ref: KometaFileRef }
  | { status: "missing"; ref: KometaFileRef; reason: string };

/** One library block under `libraries:` in config.yml. */
export interface KometaLibrary {
  /**
   * The key as written, which Kometa treats as the Plex section *title*
   * unless `library_name` overrides it.
   */
  name: string;
  /** Explicit Plex section title, when the key is just a local alias. */
  libraryName?: string;
  collectionFiles: KometaFileRef[];
  overlayFiles: KometaFileRef[];
  metadataFiles: KometaFileRef[];
  /** Library-level `template_variables`, merged under each file's own. */
  templateVariables: Record<string, unknown>;
  line?: number;
}

export interface KometaConfig {
  libraries: KometaLibrary[];
  /** Server-level `playlist_files:` — playlists aren't library-scoped. */
  playlistFiles: KometaFileRef[];
  settings: Record<string, unknown>;
  /** Which of Kometa's integrations the config had credentials for. */
  configuredIntegrations: string[];
  /** `operations:` blocks, per library name. Reported, not migrated. */
  operations: Record<string, Record<string, unknown>>;
}

/**
 * One collection definition, after templates have been expanded and before
 * anything Rube-shaped has been decided.
 *
 * `builders` and `settings` are split because they answer different
 * questions: builders decide *which items*, settings decide *what the
 * collection looks like once built*. The mapping table keys off builders; the
 * settings carry across independently and are what make a migrated rule feel
 * like the user's own rather than a generic one.
 */
export interface KometaDefinition {
  /** The YAML key under `collections:` — Kometa's "mapping name". */
  mappingName: string;
  /** `name:` if given, else the mapping name. This titles the collection. */
  collectionName: string;
  /** Builder key → its raw value, e.g. `imdb_list` → "https://…". */
  builders: Record<string, unknown>;
  /** The `filters:` block, keys verbatim (`genre.not`, `year.gte`). */
  filters: Record<string, unknown>;
  /** Everything else on the definition: limit, summary, schedule, … */
  settings: Record<string, unknown>;
  /** Which library this definition was reached through. */
  libraryName: string;
  file: string;
  line?: number;
  /**
   * Template features that applied but which we only partially modelled.
   * Carried through to the plan item's warnings so a definition built on a
   * template we half-understood is never presented as faithful.
   */
  templateWarnings: string[];
  /** Set when the definition came from our defaults table rather than a file. */
  fromDefault?: string;
}

/**
 * Loads the text behind a file reference. Injected so the mapping core stays
 * free of `fs` and `fetch` — the same property that lets the existing
 * title-scan tests run without a server, and what makes the whole builder
 * table testable against fixture configs.
 *
 * Returns null when the reference can't be satisfied; the caller turns that
 * into a diagnostic rather than throwing, because one unreachable include
 * must not sink a twenty-file import.
 */
export type FileLoader = (ref: KometaFileRef) => Promise<ImportFile[] | null>;

/** What `readImport` produces: the config, its definitions, and what went wrong. */
export interface KometaImport {
  config: KometaConfig;
  definitions: KometaDefinition[];
  diagnostics: PlanDiagnostic[];
  /** Per-reference outcome, for the Resolve step's file checklist. */
  resolutions: RefResolution[];
  /**
   * `template_variables` attached to a file reference in config.yml, keyed by
   * `kind:value`. These are how a defaults user customises anything — a
   * `default: genre` with `exclude: [Documentary]` beneath it — so they have
   * to survive as far as the defaults table, which runs after the definitions
   * have been read and can't go back to the config for them.
   */
  refVars: Map<string, Record<string, unknown>>;
  /**
   * Overlay badge configs per Kometa library name, already de-duplicated.
   * Empty when the config had no overlay files, or none we could draw.
   */
  overlays: Map<string, MappedOverlay[]>;
  /**
   * Per-item metadata edits from `metadata_files`, keyed by Kometa library.
   * The least reproducible part of a config, so the least acceptable to drop.
   */
  metadataOverrides: Map<string, MetadataOverride[]>;
  /**
   * Playlist definitions from `playlist_files:`. Not keyed by library —
   * playlists are server-level, which is the one structural difference between
   * them and collections.
   */
  playlistDefinitions: KometaDefinition[];
}
