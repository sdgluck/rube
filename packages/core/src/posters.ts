import { join } from "node:path";
import {
  createPosterCache,
  resolveKometaUrl,
  type KometaPosterSource,
  type PersonStyle,
  type PosterCache,
  type RefreshAllOptions,
  type RefreshSummary,
} from "@tinkerbell/posters";

import { token } from "@tinkerbell/container";
import type { ConfigStore } from "./config.ts";
import { dataDir } from "./paths.ts";

/**
 * The on-disk poster cache.
 *
 * Was a module-level `let` with a lazy initialiser — one per process, created
 * on whichever call happened to be first, and impossible to point somewhere
 * else in a test. As a container registration it is still exactly one per
 * process, but the process is the container's lifetime rather than the module
 * graph's, and a test can register its own.
 */
export const PosterCacheToken = token<PosterCache>("posters.cache");

export function createPosterCacheAt(dir = join(dataDir(), "posters")): PosterCache {
  return createPosterCache({ dir });
}

/**
 * Map a rule type to a Kometa kind, or null if the rule doesn't produce
 * collections that match a known Kometa asset folder. Per-collection name
 * is what each handler yields, so the kind is all we need to derive here.
 */
export function ruleTypeToKometaKind(ruleType: string): KometaPosterSource["kind"] | null {
  switch (ruleType) {
    case "studios":
      return "studio";
    case "networks":
      return "network";
    case "genres":
      return "genre";
    case "countries":
      return "country";
    case "actors":
    case "tmdb_popular_actors":
      return "actor";
    case "directors":
    case "tmdb_popular_directors":
      return "director";
    case "tmdb_franchises":
      return "franchise";
    case "decades":
      return "decade";
    case "years":
      return "year";
    case "resolutions":
      return "resolution";
    case "audio_languages":
      return "audio_language";
    case "subtitle_languages":
      return "subtitle_language";
    case "video_formats":
      return "video_format";
    case "streaming":
      // Kometa publishes streaming logos under streaming/<style>/<Name>.jpg.
      // The posters package treats it as a styled-kind so the default
      // "color" style is applied automatically.
      return "streaming";
    case "based_on":
      return "based";
    case "seasonal":
      return "seasonal";
    case "awards":
      // Kometa nests award imagery under award/<award_type>/ — there's no
      // single "awards" kind in the posters package. Skip auto-poster for
      // now; users can set posters manually post-migration.
      return null;
    default:
      return null;
  }
}

export type AutoPosterContext = {
  ruleType: string;
  collectionName: string;
};

export type AutoPosterResult =
  | { status: "applied"; url: string; fromCache: boolean }
  | { status: "missing"; url: string }
  | { status: "skipped" }
  | { status: "error"; url: string; error: Error };

export interface PostersDeps {
  config: ConfigStore;
  cache: PosterCache;
}

export function createPosters(deps: PostersDeps) {
  const { getConfig } = deps.config;
  const { cache } = deps;

  async function refreshPosterCache(opts?: RefreshAllOptions): Promise<RefreshSummary> {
    return cache.refreshAll(opts);
  }

  /**
   * Build a Kometa source from rule context, applying the user's chosen
   * actor/director style. Returns null if the rule type doesn't map.
   */
  function autoPosterSource(ctx: AutoPosterContext): KometaPosterSource | null {
    const kind = ruleTypeToKometaKind(ctx.ruleType);
    if (!kind) return null;

    const name = ctx.collectionName.trim();
    if (!name) return null;

    if (kind === "actor" || kind === "director") {
      const style: PersonStyle = getConfig("posters_kometa_person_style") ?? "bw";
      return { provider: "kometa", kind, name, style };
    }

    if (kind === "network" || kind === "country") {
      return { provider: "kometa", kind, name };
    }

    return { provider: "kometa", kind, name };
  }

  /**
   * Resolve and fetch a Kometa poster for the given rule/collection. The
   * caller is responsible for actually uploading the bytes to Plex — this
   * function only deals with sourcing and caching. Errors are returned
   * rather than thrown so the calling commit path can keep going.
   */
  async function fetchAutoPoster(
    ctx: AutoPosterContext,
  ): Promise<{ buffer: Buffer; url: string; fromCache: boolean } | AutoPosterResult> {
    if (!getConfig("posters_kometa_enabled")) {
      return { status: "skipped" };
    }

    const source = autoPosterSource(ctx);
    if (!source) return { status: "skipped" };

    const url = resolveKometaUrl(source);
    try {
      const result = await cache.getOrFetch(url);
      if (result.status === "missing") return { status: "missing", url };
      return { buffer: result.buffer, url, fromCache: result.fromCache };
    } catch (err) {
      return {
        status: "error",
        url,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  return { autoPosterSource, fetchAutoPoster, refreshPosterCache };
}

export type Posters = ReturnType<typeof createPosters>;

export const PostersToken = token<Posters>("posters");
