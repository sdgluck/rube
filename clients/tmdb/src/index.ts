/**
 * Minimal TMDb client. Used for popular-people and franchise-collection
 * lookups that aren't covered by the existing IMDb GraphQL client.
 *
 * Auth: TMDb supports both v3 API key (?api_key=...) and v4 read-access bearer
 * tokens. We accept the v3 key form to match the rest of Tinkerbell's API-key
 * config style.
 */

const BASE = "https://api.themoviedb.org/3";

export interface TmdbConfig {
  apiKey: string;
}

export interface TmdbPerson {
  id: number;
  name: string;
  knownForDepartment?: string;
  popularity?: number;
  profilePath?: string | null;
}

export interface TmdbCredit {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  year?: number;
  /** Cast: character name. Crew: job title. */
  role?: string;
  department?: string;
}

export interface TmdbCollectionPart {
  id: number;
  title: string;
  year?: number;
  releaseDate?: string;
}

export interface TmdbCollection {
  id: number;
  name: string;
  overview: string;
  parts: TmdbCollectionPart[];
}

async function tmdbFetch<T>(cfg: TmdbConfig, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("api_key", cfg.apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TMDb ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
  return res.json() as Promise<T>;
}

interface TmdbPersonRaw {
  id: number;
  name: string;
  known_for_department?: string;
  popularity?: number;
  profile_path?: string | null;
}

interface TmdbPersonPopularResponse {
  page: number;
  total_pages: number;
  results: TmdbPersonRaw[];
}

/**
 * Returns up to `limit` popular people, optionally filtered by their
 * `known_for_department` (e.g. "Acting", "Directing"). TMDb's /person/popular
 * returns mixed departments; we paginate until the filtered count reaches the
 * limit or we exhaust ~10 pages.
 */
export async function fetchPopularPeople(
  cfg: TmdbConfig,
  opts: { limit: number; department?: "Acting" | "Directing" },
): Promise<TmdbPerson[]> {
  const { limit, department } = opts;
  const out: TmdbPerson[] = [];
  let page = 1;
  while (out.length < limit && page <= 10) {
    const data = await tmdbFetch<TmdbPersonPopularResponse>(cfg, "/person/popular", { page: String(page) });
    for (const p of data.results) {
      if (department && p.known_for_department !== department) continue;
      out.push({
        id: p.id,
        name: p.name,
        knownForDepartment: p.known_for_department,
        popularity: p.popularity,
        profilePath: p.profile_path,
      });
      if (out.length >= limit) break;
    }
    if (page >= data.total_pages) break;
    page++;
  }
  return out;
}

interface TmdbCreditRaw {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  character?: string;
  job?: string;
  department?: string;
}

interface TmdbCombinedCreditsResponse {
  cast: TmdbCreditRaw[];
  crew: TmdbCreditRaw[];
}

interface TmdbMovieCreditsResponse {
  cast: TmdbCreditRaw[];
  crew: TmdbCreditRaw[];
}

interface TmdbTvCreditsResponse {
  cast: TmdbCreditRaw[];
  crew: TmdbCreditRaw[];
}

function yearFromDate(d?: string): number | undefined {
  if (!d) return undefined;
  const m = d.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Fetch a person's filmography. `role` = "cast" (acting credits) or "crew"
 * (with optional `crewJob` filter, e.g. "Director").
 */
export async function fetchPersonCredits(
  cfg: TmdbConfig,
  personId: number,
  opts: { role: "cast" | "crew"; crewJob?: string; mediaTypes?: Array<"movie" | "tv"> },
): Promise<TmdbCredit[]> {
  const mediaTypes = opts.mediaTypes ?? ["movie", "tv"];
  const out: TmdbCredit[] = [];
  const seen = new Set<string>();

  for (const mt of mediaTypes) {
    const path = mt === "movie" ? `/person/${personId}/movie_credits` : `/person/${personId}/tv_credits`;
    const data = await tmdbFetch<TmdbMovieCreditsResponse | TmdbTvCreditsResponse>(cfg, path);
    const list = opts.role === "cast" ? data.cast : data.crew;
    for (const c of list) {
      if (opts.role === "crew" && opts.crewJob && c.job !== opts.crewJob) continue;
      const title = c.title ?? c.name ?? "";
      const year = yearFromDate(c.release_date ?? c.first_air_date);
      const key = `${mt}:${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: c.id,
        mediaType: mt,
        title,
        year,
        role: opts.role === "cast" ? c.character : c.job,
        department: c.department,
      });
    }
  }

  return out;
}

interface TmdbCollectionPartRaw {
  id: number;
  title: string;
  release_date?: string;
}

interface TmdbCollectionResponse {
  id: number;
  name: string;
  overview: string;
  parts: TmdbCollectionPartRaw[];
}

export async function fetchCollection(cfg: TmdbConfig, collectionId: number): Promise<TmdbCollection> {
  const data = await tmdbFetch<TmdbCollectionResponse>(cfg, `/collection/${collectionId}`);
  return {
    id: data.id,
    name: data.name,
    overview: data.overview,
    parts: data.parts.map((p) => ({
      id: p.id,
      title: p.title,
      releaseDate: p.release_date,
      year: yearFromDate(p.release_date),
    })),
  };
}

export async function testTmdbKey(apiKey: string): Promise<{ ok: true; sample: string }> {
  const data = await tmdbFetch<{ id: number; title: string }>({ apiKey }, "/movie/550");
  return { ok: true, sample: data.title };
}

export async function fetchCombinedCredits(cfg: TmdbConfig, personId: number): Promise<TmdbCombinedCreditsResponse> {
  return tmdbFetch<TmdbCombinedCreditsResponse>(cfg, `/person/${personId}/combined_credits`);
}
