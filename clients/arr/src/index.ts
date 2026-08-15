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
      // Only retry reads. `arrFetch` is GET-only today, but the `init` escape
      // hatch means a future caller could pass a mutation through here, and
      // silently re-sending one of those would be much worse than a failure.
      retries: !init?.method || init.method === "GET" ? 2 : 0,
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
    // A DELETE or PUT can legitimately answer 200 with an empty body, and both
    // *Arrs do in some versions. Parsing that as JSON throws *after* the
    // mutation has already happened — which for a delete means the file is
    // gone, the caller sees a failure, and the item is retried forever.
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
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

// ─── Library records (as opposed to add-search lookups) ─────────────────────

export interface ArrRecord {
  service: ArrService;
  /** The *Arr database id — what the mutation endpoints take. */
  id: number;
  title: string;
  monitored: boolean;
  hasFile: boolean;
  raw: Record<string, unknown>;
}

function toRecord(cfg: ArrConfig, row: Record<string, unknown>): ArrRecord {
  return {
    service: cfg.service,
    id: row.id as number,
    title: (row.title as string) ?? "",
    monitored: row.monitored === true,
    // Sonarr has no `hasFile`; a series counts as present if any episode is on
    // disk, which `statistics.episodeFileCount` reports.
    hasFile:
      cfg.service === "radarr"
        ? row.hasFile === true
        : ((row.statistics as { episodeFileCount?: number } | undefined)?.episodeFileCount ?? 0) > 0,
    raw: row,
  };
}

/**
 * Find an item **already in the *Arr library** by external id.
 *
 * Distinct from `lookupByExternalId`, which searches the metadata provider to
 * find something to add — that returns a candidate with no `id`, and the
 * mutation endpoints need the library row. Deleting the wrong thing because a
 * search result was mistaken for a library record is exactly the failure this
 * separation exists to prevent.
 *
 * `externalId` is `tmdb:N` / `imdb:ttN` / `tvdb:N`, matching `ArrLookupResult`.
 */
export async function findByExternalId(cfg: ArrConfig, externalId: string): Promise<ArrRecord | null> {
  const [scheme, value] = splitExternalId(externalId);
  if (!scheme || !value) return null;

  if (cfg.service === "radarr") {
    // Radarr indexes the whole movie list by tmdbId server-side.
    if (scheme === "tmdb") {
      const data = (await arrFetch(cfg, `/api/v3/movie?tmdbId=${encodeURIComponent(value)}`)) as Array<
        Record<string, unknown>
      >;
      const first = data?.[0];
      return first ? toRecord(cfg, first) : null;
    }
    const all = (await arrFetch(cfg, "/api/v3/movie")) as Array<Record<string, unknown>>;
    const hit = all?.find((m) => m.imdbId === value);
    return hit ? toRecord(cfg, hit) : null;
  }

  const all = (await arrFetch(cfg, "/api/v3/series")) as Array<Record<string, unknown>>;
  const hit = all?.find((s) =>
    scheme === "tvdb"
      ? String(s.tvdbId) === value
      : scheme === "imdb"
        ? s.imdbId === value
        : String(s.tmdbId) === value,
  );
  return hit ? toRecord(cfg, hit) : null;
}

function splitExternalId(externalId: string): [scheme: string | null, value: string | null] {
  const idx = externalId.indexOf(":");
  if (idx < 0) return [null, null];
  return [externalId.slice(0, idx), externalId.slice(idx + 1)];
}

/**
 * Monitor or unmonitor a library record.
 *
 * PUT with the full record rather than a patch — both *Arrs replace the row
 * wholesale and will null out anything the body omits.
 *
 * Not retried. See `deleteRecord`.
 */
export async function setMonitored(cfg: ArrConfig, record: ArrRecord, monitored: boolean): Promise<void> {
  const path = cfg.service === "radarr" ? `/api/v3/movie/${record.id}` : `/api/v3/series/${record.id}`;
  await arrFetch(cfg, path, {
    method: "PUT",
    body: JSON.stringify({ ...record.raw, monitored }),
  });
}

export interface DeleteOptions {
  deleteFiles: boolean;
  /**
   * Add to the *Arr import exclusion list, so an upstream list that still
   * contains the item doesn't re-add it on the next sync.
   */
  addImportExclusion: boolean;
}

/**
 * Remove a record from Radarr/Sonarr, optionally taking the files with it.
 *
 * **Never retried, unlike the GET paths.** `arrFetch` already sets
 * `retries: 0` for non-GET, and that matters most here: a DELETE that actually
 * succeeded but whose response was lost would, on retry, 404 harmlessly — but
 * the same retry re-sends `addImportExclusion`, and a duplicated exclusion
 * entry is a silent "this will never come back" that nobody goes looking for.
 * One failed delete that gets retried on the next scheduled run is strictly
 * better than an exclusion list nobody can explain.
 */
export async function deleteRecord(cfg: ArrConfig, record: ArrRecord, opts: DeleteOptions): Promise<void> {
  const base = cfg.service === "radarr" ? `/api/v3/movie/${record.id}` : `/api/v3/series/${record.id}`;
  const params = new URLSearchParams({
    deleteFiles: String(opts.deleteFiles),
    // The two *Arrs spell this differently and ignore the other's spelling,
    // so both are sent rather than branching and getting it wrong for one.
    addImportExclusion: String(opts.addImportExclusion),
    addImportListExclusion: String(opts.addImportExclusion),
  });
  await arrFetch(cfg, `${base}?${params}`, { method: "DELETE" });
}

export async function getSystemStatus(cfg: ArrConfig): Promise<{ instanceName: string; version: string }> {
  const data = (await arrFetch(cfg, "/api/v3/system/status")) as {
    instanceName?: string;
    appName?: string;
    version?: string;
  };
  return { instanceName: data.instanceName || data.appName || "Unknown", version: data.version || "?" };
}
