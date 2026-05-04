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
import { getConfig } from "./config.ts";

let cacheSingleton: PosterCache | null = null;

function dataDir(): string {
  return process.env.DATA_DIR || join(import.meta.dirname, "..", "..", "..", "..");
}

export function posterCache(): PosterCache {
  if (!cacheSingleton) {
    cacheSingleton = createPosterCache({ dir: join(dataDir(), "posters") });
  }
  return cacheSingleton;
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
    default:
      return null;
  }
}

export async function refreshPosterCache(opts?: RefreshAllOptions): Promise<RefreshSummary> {
  return posterCache().refreshAll(opts);
}

export type AutoPosterContext = {
  ruleType: string;
  collectionName: string;
};

/**
 * Build a Kometa source from rule context, applying the user's chosen
 * actor/director style. Returns null if the rule type doesn't map.
 */
export function autoPosterSource(ctx: AutoPosterContext): KometaPosterSource | null {
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

export type AutoPosterResult =
  | { status: "applied"; url: string; fromCache: boolean }
  | { status: "missing"; url: string }
  | { status: "skipped" }
  | { status: "error"; url: string; error: Error };

/**
 * Resolve and fetch a Kometa poster for the given rule/collection. The
 * caller is responsible for actually uploading the bytes to Plex — this
 * function only deals with sourcing and caching. Errors are returned
 * rather than thrown so the calling commit path can keep going.
 */
export async function fetchAutoPoster(
  ctx: AutoPosterContext,
): Promise<{ buffer: Buffer; url: string; fromCache: boolean } | AutoPosterResult> {
  if (!getConfig("posters_kometa_enabled")) {
    return { status: "skipped" };
  }

  const source = autoPosterSource(ctx);
  if (!source) return { status: "skipped" };

  const url = resolveKometaUrl(source);
  try {
    const result = await posterCache().getOrFetch(url);
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
