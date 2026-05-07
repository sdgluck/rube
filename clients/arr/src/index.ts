import { httpRequest, HttpError } from "@tinkerbell/http";

export type ArrService = "radarr" | "sonarr";

export interface ArrConfig {
  service: ArrService;
  url: string;
  apiKey: string;
}

export interface QualityProfile {
  id: number;
  name: string;
}

export interface RootFolder {
  id: number;
  path: string;
  freeSpace?: number;
  accessible?: boolean;
}

export interface ArrLookupResult {
  service: ArrService;
  title: string;
  year?: number;
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
  remotePoster?: string;
  // Raw payload — needed verbatim for the add request body.
  raw: Record<string, unknown>;
}

export interface ArrAddResult {
  status: "added" | "exists" | "failed";
  id?: number;
  title?: string;
  error?: string;
}

async function arrFetch(cfg: ArrConfig, path: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(path, cfg.url);
  try {
    const res = await httpRequest({
      url,
      timeoutMs: 15_000,
      init: {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Api-Key": cfg.apiKey,
          ...init?.headers,
        },
      },
    });
    if (res.status === 204) return null;
    return await res.json();
  } catch (err) {
    if (err instanceof HttpError) {
      throw new Error(`${cfg.service} ${err.message}`);
    }
    throw err;
  }
}

export async function getQualityProfiles(cfg: ArrConfig): Promise<QualityProfile[]> {
  const data = (await arrFetch(cfg, "/api/v3/qualityprofile")) as Array<{ id: number; name: string }>;
  return data.map((p) => ({ id: p.id, name: p.name }));
}

export async function getRootFolders(cfg: ArrConfig): Promise<RootFolder[]> {
  const data = (await arrFetch(cfg, "/api/v3/rootfolder")) as Array<{
    id: number;
    path: string;
    freeSpace?: number;
    accessible?: boolean;
  }>;
  return data.map((f) => ({ id: f.id, path: f.path, freeSpace: f.freeSpace, accessible: f.accessible }));
}

/**
 * Look up an item by external ID. Radarr supports `imdb:tt...` and `tmdb:N`;
 * Sonarr supports `imdb:tt...` and `tvdb:N`. Returns the first match (or null).
 */
export async function lookupByExternalId(cfg: ArrConfig, term: string): Promise<ArrLookupResult | null> {
  const path = cfg.service === "radarr" ? "/api/v3/movie/lookup" : "/api/v3/series/lookup";
  const url = `${path}?term=${encodeURIComponent(term)}`;
  const data = (await arrFetch(cfg, url)) as Array<Record<string, unknown>>;
  const first = data?.[0];
  if (!first) return null;
  return {
    service: cfg.service,
    title: (first.title as string) ?? "",
    year: first.year as number | undefined,
    imdbId: first.imdbId as string | undefined,
    tmdbId: first.tmdbId as number | undefined,
    tvdbId: first.tvdbId as number | undefined,
    remotePoster: first.remotePoster as string | undefined,
    raw: first,
  };
}

export interface AddOptions {
  qualityProfileId: number;
  rootFolderPath: string;
  monitor: boolean;
  searchOnAdd: boolean;
  /** Sonarr only — defaults to "all" (monitor every season). */
  seriesMonitorMode?: "all" | "future" | "missing" | "existing" | "firstSeason" | "latestSeason" | "none";
}

/**
 * Add a previously-looked-up item to Radarr/Sonarr. Treats HTTP 400 with the
 * "already exists" error code as `status: "exists"` rather than failing.
 */
export async function addItem(cfg: ArrConfig, lookup: ArrLookupResult, opts: AddOptions): Promise<ArrAddResult> {
  const path = cfg.service === "radarr" ? "/api/v3/movie" : "/api/v3/series";
  const body: Record<string, unknown> = {
    ...lookup.raw,
    qualityProfileId: opts.qualityProfileId,
    rootFolderPath: opts.rootFolderPath,
    monitored: opts.monitor,
    addOptions:
      cfg.service === "radarr"
        ? { searchForMovie: opts.searchOnAdd, monitor: opts.monitor ? "movieOnly" : "none" }
        : {
            monitor: opts.seriesMonitorMode ?? "all",
            searchForMissingEpisodes: opts.searchOnAdd,
            searchForCutoffUnmetEpisodes: false,
          },
  };

  const url = new URL(path, cfg.url);
  // `addItem` does its own status branching so we use raw fetch here rather
  // than `httpRequest` (which would throw on the 400-already-exists path
  // we want to translate into `status: "exists"`).
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Api-Key": cfg.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  if (res.ok) {
    const data = (await res.json()) as { id?: number; title?: string };
    return { status: "added", id: data.id, title: data.title };
  }

  const text = await res.text().catch(() => "");
  if (res.status === 400 && /already.*been added|already exists/i.test(text)) {
    return { status: "exists", title: lookup.title };
  }
  return { status: "failed", error: `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}` };
}

export async function getSystemStatus(cfg: ArrConfig): Promise<{ instanceName: string; version: string }> {
  const data = (await arrFetch(cfg, "/api/v3/system/status")) as {
    instanceName?: string;
    appName?: string;
    version?: string;
  };
  return { instanceName: data.instanceName || data.appName || "Unknown", version: data.version || "?" };
}
