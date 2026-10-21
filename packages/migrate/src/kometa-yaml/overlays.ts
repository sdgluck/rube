import { asRecord, asStringList, parseYamlFile } from "./parse.ts";
import type { ImportFile } from "./types.ts";
import type { PlanDiagnostic, PlanWarning } from "../types.ts";

/**
 * Kometa overlay files → Rube overlay configs.
 *
 * The two systems disagree about what an overlay *is*, and the mapping is only
 * honest if that's said plainly.
 *
 * Kometa composites arbitrary images at arbitrary pixel coordinates, scoped by
 * builder — "this ribbon, on these forty films, 30px from the left". Rube
 * draws text badges from a fixed set of twelve facts, at one of nine anchors,
 * scoped to a whole library. So this mapper does not translate a layout; it
 * recognises the *intent* behind Kometa's own overlay defaults — "show me
 * resolution", "show me ratings" — and rebuilds that intent in Rube's
 * vocabulary.
 *
 * That's a real migration for the common case (almost everybody runs the
 * defaults) and an honest failure for the rest. What it must never do is
 * produce something that looks like a faithful copy of a hand-made layout,
 * because a user would then compare it against their posters and conclude
 * Rube's overlay system is broken rather than different.
 */

/** Rube's nine anchors. */
export type OverlayPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/** One row destined for `overlay_configs`, in export-file shape. */
export interface MappedOverlay {
  position: OverlayPosition;
  overlayType: string;
  style?: Record<string, unknown> | null;
  rule?: Record<string, unknown> | null;
  order?: number;
}

export interface OverlayMapping {
  /** Kometa library name → the configs to apply to its Plex section. */
  byLibrary: Map<string, MappedOverlay[]>;
  diagnostics: PlanDiagnostic[];
  warnings: PlanWarning[];
}

/**
 * Kometa overlay default → the Rube badge it means, and where it usually
 * sits. Positions follow Kometa's own default placements so a migrated library
 * looks broadly like the one it came from.
 */
const DEFAULT_OVERLAYS: Record<string, { type: string; position: OverlayPosition }> = {
  resolution: { type: "resolution", position: "top-left" },
  audio_codec: { type: "audio_codec", position: "top-left" },
  video_format: { type: "video_codec", position: "top-left" },
  ratings: { type: "imdb_rating", position: "top-right" },
  content_rating_us_movie: { type: "content_rating", position: "bottom-left" },
  content_rating_us_show: { type: "content_rating", position: "bottom-left" },
  content_rating_uk: { type: "content_rating", position: "bottom-left" },
  content_rating_de: { type: "content_rating", position: "bottom-left" },
  content_rating_au: { type: "content_rating", position: "bottom-left" },
  content_rating_nz: { type: "content_rating", position: "bottom-left" },
  commonsense: { type: "content_rating", position: "bottom-left" },
  runtimes: { type: "runtime", position: "bottom-right" },
  status: { type: "show_status", position: "top-right" },
  studio: { type: "studio", position: "bottom-right" },
  editions: { type: "edition", position: "bottom-right" },
  audio_channels: { type: "audio_channels", position: "top-left" },
};

/**
 * Overlay defaults we recognise and can't draw, with the reason.
 *
 * These are the ones people notice missing, so each says what it was rather
 * than "unsupported" — the difference between a user understanding the limit
 * and filing a bug.
 */
const UNSUPPORTED_OVERLAYS: Record<string, string> = {
  ribbon: "award ribbons are images, and Rube's overlays are text badges",
  streaming: "streaming-service logos are images, and Rube's overlays are text badges",
  network: "network logos are images, and Rube's overlays are text badges",
  mediastinger: "the post-credits marker has no Rube equivalent",
  versions: "the multiple-versions marker has no Rube equivalent",
  direct_play: "the direct-play marker has no Rube equivalent",
  episode_info: "episode numbering overlays aren't supported",
  languages: "language flags are images, and Rube's overlays are text badges",
  audio_language: "language flags are images, and Rube's overlays are text badges",
  aspect: "aspect-ratio overlays aren't supported",
};

/** Kometa's ratings overlay can carry up to three sources. */
const RATING_TYPES: Record<string, string> = {
  imdb: "imdb_rating",
  rt: "rt_rating",
  rotten: "rt_rating",
  critic: "rt_rating",
  audience: "rt_rating",
  tmdb: "imdb_rating",
  user: "imdb_rating",
};

/**
 * Kometa's `horizontal_align` / `vertical_align` → one of the nine anchors.
 *
 * Pixel offsets are deliberately ignored rather than bucketed: an offset is
 * meaningful only relative to a specific poster size and a specific image, and
 * quietly rounding "30px from the left" to "left" is the same answer with a
 * false suggestion of precision.
 */
function anchorFrom(horizontal: unknown, vertical: unknown): OverlayPosition {
  const h = String(horizontal ?? "left").toLowerCase();
  const v = String(vertical ?? "top").toLowerCase();
  const hx = h === "right" ? "right" : h === "center" ? "center" : "left";
  const vy = v === "bottom" ? "bottom" : v === "center" ? "middle" : "top";
  return `${vy}-${hx}` as OverlayPosition;
}

interface CollectOptions {
  /** Which library this overlay file was reached through. */
  libraryName: string;
  /** `default:` name, when the reference was a Kometa default. */
  defaultName?: string;
  /** File contents, when the reference resolved to a real file. */
  file?: ImportFile;
  /** `template_variables` attached to the reference. */
  vars: Record<string, unknown>;
}

/**
 * Turn one overlay reference into badge configs.
 *
 * Returns an empty list rather than throwing for anything unrecognised — an
 * overlay we can't draw must not stop the ones we can.
 */
export function mapOverlayRef(opts: CollectOptions): {
  configs: MappedOverlay[];
  diagnostics: PlanDiagnostic[];
} {
  const diagnostics: PlanDiagnostic[] = [];
  const configs: MappedOverlay[] = [];

  if (opts.defaultName) {
    const key = opts.defaultName.trim().replace(/\.ya?ml$/i, "");

    if (key in UNSUPPORTED_OVERLAYS) {
      diagnostics.push({
        severity: "warn",
        message: `Overlay "${key}" wasn't migrated — ${UNSUPPORTED_OVERLAYS[key]}.`,
      });
      return { configs, diagnostics };
    }

    const mapping = DEFAULT_OVERLAYS[key];
    if (!mapping) {
      diagnostics.push({
        severity: "warn",
        message: `Overlay "${key}" wasn't recognised, so it wasn't migrated.`,
      });
      return { configs, diagnostics };
    }

    // The ratings overlay is the one default that expands: Kometa draws up to
    // three sources from it, and migrating only the first would silently halve
    // what a user sees on every poster.
    if (key === "ratings") {
      const wanted = new Set<string>();
      for (const varName of ["rating1", "rating2", "rating3"]) {
        const source = String(opts.vars[varName] ?? "").toLowerCase();
        const type = RATING_TYPES[source];
        if (type) wanted.add(type);
      }
      if (wanted.size === 0) wanted.add("imdb_rating");
      let order = 0;
      for (const type of wanted) {
        configs.push({ position: "top-right", overlayType: type, order: order++ });
      }
      return { configs, diagnostics };
    }

    configs.push({ position: mapping.position, overlayType: mapping.type });
    return { configs, diagnostics };
  }

  if (!opts.file) return { configs, diagnostics };

  // A hand-written overlay file. Kometa's format here is a map of overlay
  // definitions, each with an `overlay:` block carrying a name and placement.
  const parsed = parseYamlFile(opts.file.path, opts.file.text);
  diagnostics.push(...parsed.diagnostics);
  const root = asRecord(parsed.value);
  const block = asRecord(root?.overlays);
  if (!block) return { configs, diagnostics };

  let unmapped = 0;
  for (const [name, rawDef] of Object.entries(block)) {
    const def = asRecord(rawDef);
    const overlay = asRecord(def?.overlay);
    const overlayName = String(overlay?.name ?? name).toLowerCase();

    // `text(...)` and image overlays are the two shapes Kometa writes; only the
    // first has any chance of a text-badge equivalent, and even then the text
    // is arbitrary rather than one of our twelve facts.
    const matched = Object.entries(DEFAULT_OVERLAYS).find(([key]) => overlayName.includes(key));
    if (!matched) {
      unmapped++;
      continue;
    }
    const [, mapping] = matched;
    configs.push({
      position: anchorFrom(overlay?.horizontal_align, overlay?.vertical_align),
      overlayType: mapping.type,
    });
  }

  if (unmapped > 0) {
    diagnostics.push({
      severity: "warn",
      message: `${opts.file.path}: ${unmapped} overlay definition(s) had no Rube equivalent — Rube draws text badges from a fixed set of facts, not arbitrary images.`,
    });
  }

  return { configs, diagnostics };
}

/**
 * De-duplicate and renumber.
 *
 * Two Kometa files both asking for a resolution badge is common (a defaults
 * file plus a personal one), and `overlay_configs` has a unique index on
 * `(section, position, order)` — so a duplicate isn't just untidy, it's a
 * constraint violation waiting to happen at import.
 */
export function normaliseOverlays(configs: MappedOverlay[]): MappedOverlay[] {
  const seen = new Set<string>();
  const kept: MappedOverlay[] = [];
  for (const config of configs) {
    const key = `${config.position}::${config.overlayType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(config);
  }

  const byPosition = new Map<string, number>();
  return kept.map((config) => {
    const next = byPosition.get(config.position) ?? 0;
    byPosition.set(config.position, next + 1);
    return { ...config, order: next };
  });
}

/** Kometa `template_variables` on an overlay reference, normalised. */
export function overlayVars(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

/** Exported for the "what didn't come across" report. */
export { UNSUPPORTED_OVERLAYS, DEFAULT_OVERLAYS };

/** `asStringList` is re-exported so the runtime can read `builder_level` lists. */
export { asStringList };
