import { readConfig, refKey } from "./config.ts";
import { readDefinitions } from "./definition.ts";
import { bundleLoader, isYaml, resolveRefs } from "./includes.ts";
import { mapOverlayRef, normaliseOverlays, type MappedOverlay } from "./overlays.ts";
import { readMetadataFile, type MetadataOverride } from "./metadata.ts";
import type { FileLoader, ImportFile, KometaDefinition, KometaImport, RefResolution } from "./types.ts";
import type { PlanDiagnostic } from "../types.ts";

/**
 * Read a whole Kometa config bundle: find config.yml, resolve what it points
 * at, and expand every collection definition it reaches.
 *
 * The traversal is per-library rather than per-file, and that matters. The
 * same collection file referenced from two libraries produces two sets of
 * definitions targeting two Plex sections — which is exactly what Kometa does,
 * and losing it would silently drop half of a movies-plus-4K setup.
 */

/** Filenames that look like a Kometa entrypoint, best first. */
const CONFIG_NAMES = ["config.yml", "config.yaml"];

export function findConfigFile(files: ImportFile[]): ImportFile | null {
  const normalised = files.map((f) => ({ file: f, path: f.path.replace(/\\/g, "/").toLowerCase() }));

  for (const name of CONFIG_NAMES) {
    // Prefer the shallowest match: a `config.yml` at the root of what the user
    // picked beats one inside a backup folder three levels down.
    const matches = normalised
      .filter(({ path }) => path === name || path.endsWith(`/${name}`))
      .sort((a, b) => a.path.split("/").length - b.path.split("/").length);
    if (matches.length > 0) return matches[0]!.file;
  }

  // A user who pasted only their config has one file and it may be named
  // anything. If there's exactly one YAML file and it has a `libraries:` key,
  // it's the config.
  const yamls = files.filter((f) => isYaml(f.path) || !f.path.includes("."));
  if (yamls.length === 1 && /^\s*libraries\s*:/m.test(yamls[0]!.text)) return yamls[0]!;

  return null;
}

export interface ReadImportOptions {
  files: ImportFile[];
  /** Overrides bundle-only resolution — used to add server-path or remote reads. */
  loader?: FileLoader;
}

export async function readImport(opts: ReadImportOptions): Promise<KometaImport> {
  const { files } = opts;
  const diagnostics: PlanDiagnostic[] = [];

  const configFile = findConfigFile(files);
  if (!configFile) {
    return {
      config: { libraries: [], playlistFiles: [], settings: {}, configuredIntegrations: [], operations: {} },
      definitions: [],
      diagnostics: [
        {
          severity: "error",
          message:
            "Couldn't find a config.yml. Include your Kometa config file — it's the one with a `libraries:` block.",
        },
      ],
      resolutions: [],
      refVars: new Map(),
      overlays: new Map(),
      metadataOverrides: new Map(),
      playlistDefinitions: [],
    };
  }

  const { config, diagnostics: configDiagnostics, refVars } = readConfig(configFile.path, configFile.text);
  diagnostics.push(...configDiagnostics);

  const load = opts.loader ?? bundleLoader(files);
  const definitions: KometaImport["definitions"] = [];
  const resolutions: RefResolution[] = [];
  const overlays = new Map<string, MappedOverlay[]>();
  const metadataOverrides = new Map<string, MetadataOverride[]>();

  for (const library of config.libraries) {
    const { resolutions: libResolutions, diagnostics: refDiagnostics } = await resolveRefs(
      library.collectionFiles,
      load,
    );
    resolutions.push(...libResolutions);
    diagnostics.push(...refDiagnostics);

    for (const resolution of libResolutions) {
      if (resolution.status !== "resolved") continue;
      const vars = refVars.get(refKey(resolution.ref)) ?? {};

      for (const file of resolution.files) {
        const result = readDefinitions({
          file,
          libraryName: library.libraryName ?? library.name,
          libraryVars: library.templateVariables,
          refVars: vars,
        });
        definitions.push(...result.definitions);
        diagnostics.push(...result.diagnostics);
      }
    }

    // ─── Overlays ───────────────────────────────────────────────────────
    //
    // Mapped rather than merely counted: Tinkerbell has its own overlay system,
    // and the badges somebody chose to show are as much a part of "how my
    // library looks" as the collections are.
    const libraryOverlays: MappedOverlay[] = [];
    const { resolutions: overlayResolutions, diagnostics: overlayRefDiagnostics } = await resolveRefs(
      library.overlayFiles,
      load,
    );
    diagnostics.push(...overlayRefDiagnostics);

    for (const resolution of overlayResolutions) {
      const vars = refVars.get(refKey(resolution.ref)) ?? {};
      if (resolution.status === "default") {
        const mapped = mapOverlayRef({ libraryName: library.name, defaultName: resolution.ref.value, vars });
        libraryOverlays.push(...mapped.configs);
        diagnostics.push(...mapped.diagnostics);
        continue;
      }
      if (resolution.status !== "resolved") continue;
      for (const file of resolution.files) {
        const mapped = mapOverlayRef({ libraryName: library.name, file, vars });
        libraryOverlays.push(...mapped.configs);
        diagnostics.push(...mapped.diagnostics);
      }
    }

    if (libraryOverlays.length > 0) {
      overlays.set(library.libraryName ?? library.name, normaliseOverlays(libraryOverlays));
    }

    // ─── Per-item metadata ──────────────────────────────────────────────
    const libraryName = library.libraryName ?? library.name;
    const overrides: MetadataOverride[] = [];
    const { resolutions: metaResolutions, diagnostics: metaRefDiagnostics } = await resolveRefs(
      library.metadataFiles,
      load,
    );
    diagnostics.push(...metaRefDiagnostics);

    for (const resolution of metaResolutions) {
      if (resolution.status !== "resolved") continue;
      for (const file of resolution.files) {
        const result = readMetadataFile(file, libraryName);
        overrides.push(...result.overrides);
        diagnostics.push(...result.diagnostics);
      }
    }
    if (overrides.length > 0) metadataOverrides.set(libraryName, overrides);
  }

  // ─── Playlists ─────────────────────────────────────────────────────────
  //
  // Server-level rather than per-library, which is the one structural way they
  // differ from collections. The definitions themselves are the same format.
  const playlistDefinitions: KometaDefinition[] = [];
  if (config.playlistFiles.length > 0) {
    const { resolutions: playlistResolutions, diagnostics: playlistRefDiagnostics } = await resolveRefs(
      config.playlistFiles,
      load,
    );
    diagnostics.push(...playlistRefDiagnostics);

    for (const resolution of playlistResolutions) {
      if (resolution.status === "default") {
        diagnostics.push({
          severity: "warn",
          message: `Kometa's built-in "${resolution.ref.value}" playlist file isn't recognised, so those playlists weren't migrated.`,
        });
        continue;
      }
      if (resolution.status !== "resolved") continue;
      const vars = refVars.get(refKey(resolution.ref)) ?? {};
      for (const file of resolution.files) {
        const result = readDefinitions({
          file,
          libraryName: "*",
          libraryVars: {},
          refVars: vars,
          block: "playlists",
        });
        playlistDefinitions.push(...result.definitions);
        diagnostics.push(...result.diagnostics);
      }
    }
  }

  const operationLibraries = Object.keys(config.operations);
  if (operationLibraries.length > 0) {
    diagnostics.push({
      severity: "warn",
      message: `\`operations:\` found on ${operationLibraries.join(", ")}. Library-wide operations (mass metadata updates, duplicate splitting, asset application) aren't migrated.`,
    });
  }

  return {
    config,
    definitions,
    diagnostics,
    resolutions,
    refVars,
    overlays,
    metadataOverrides,
    playlistDefinitions,
  };
}
