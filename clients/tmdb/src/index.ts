/**
 * Minimal TMDb client. Used for popular-people, franchise-collection, and
 * grouped-rule (studios/networks/genres/...) lookups.
 *
 * Auth: TMDb's /3 endpoints accept the API key as either `?api_key=…` or
 * `Authorization: Bearer …`. We use the header form so the key never lands
 * in HTTP access logs / proxy logs / browser history. Both v3 (32-hex) keys
 * and v4 read-access tokens work over Bearer.
 *
 * Validation: all responses pass through Zod parsers. The API has a habit of
 * returning unexpected nulls and occasionally adding fields, so we declare
 * what we use and let unknown fields fall away.
 */

import PQueue from "p-queue";
import { z } from "zod";
import { httpRequest, HttpError } from "@tinkerbell/http";

const BASE = "https://api.themoviedb.org/3";

/**
 * Ceiling on TMDb requests in flight, for the whole process.
 *
 * It lives here rather than at the call sites because the call sites multiply:
 * rules run concurrently, several of them fan out over people or franchises,
 * and each of those fans out again over credits. A per-caller limit is a
 * per-caller limit times however many callers there are, which is how you find
 * out what TMDb's rate limiter does. One queue at the only place every request
 * must pass through is the only bound that actually holds.
 */
const TMDB_CONCURRENCY = 8;
const tmdbQueue = new PQueue({ concurrency: TMDB_CONCURRENCY });

export interface TmdbConfig {
  apiKey: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────

/**
 * TMDb answers almost every auth failure with a bare 401 and puts the real
 * reason in a `status_code` in the body. A suspended key, a key TMDb has
 * never heard of, and an unverified email are three different problems with
 * three different fixes, and they arrive over the wire looking identical.
 * Collapsing them into "TMDb 401 Unauthorized" sent one debugging session
 * chasing an account ban that turned out to be a rotated key.
 */
export class TmdbError extends Error {
  /** HTTP status of the failing response. */
  readonly httpStatus: number;
  /** TMDb's own `status_code`, when the body carried one. */
  readonly statusCode?: number;
  constructor(message: string, httpStatus: number, statusCode?: number) {
    super(message);
    this.name = "TmdbError";
    this.httpStatus = httpStatus;
    this.statusCode = statusCode;
  }
}

/**
 * What an admin should actually *do* about each `status_code`, since TMDb's
 * own `status_message` says what happened but never what to change.
 */
const TMDB_STATUS_HINTS: Record<number, string> = {
  3: "authentication failed — the key is recognised but isn't permitted to use this endpoint.",
  7: "invalid API key — TMDb doesn't recognise it. Compare Settings → Databases → TMDb against themoviedb.org/settings/api; regenerating a key silently kills the old one.",
  10: "suspended API key — TMDb has suspended access for this account. A new key won't help; contact TMDb support.",
  25: "rate limited — too many requests in the window. This clears on its own.",
  32: "email not verified — confirm the email on the TMDb account before the key will work.",
  34: "the requested resource does not exist.",
};

function tmdbErrorFrom(err: HttpError, path: string): TmdbError {
  let statusCode: number | undefined;
  let statusMessage: string | undefined;
  try {
    const body: unknown = JSON.parse(err.body);
    if (body && typeof body === "object") {
      const { status_code, status_message } = body as Record<string, unknown>;
      if (typeof status_code === "number") statusCode = status_code;
      if (typeof status_message === "string") statusMessage = status_message;
    }
  } catch {
    // Non-JSON body — a proxy error page, or a payload truncated by
    // errorBodyMaxLen. Fall back to the raw HTTP status below.
  }
  const detail = (statusCode !== undefined ? TMDB_STATUS_HINTS[statusCode] : undefined) ?? statusMessage ?? err.message;
  const code = statusCode !== undefined ? ` (status_code ${statusCode})` : "";
  return new TmdbError(`TMDb ${path}: ${detail}${code}`, err.status, statusCode);
}

// ─── Shared atomic schemas ───────────────────────────────────────────────

const personRawSchema = z.object({
  id: z.number(),
  name: z.string(),
  known_for_department: z.string().optional(),
  popularity: z.number().optional(),
  profile_path: z.string().nullable().optional(),
});

const creditRawSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  character: z.string().optional(),
  job: z.string().optional(),
  department: z.string().optional(),
});

const castRawSchema = z.object({
  id: z.number(),
  name: z.string(),
  order: z.number().optional(),
});

const crewRawSchema = z.object({
  id: z.number(),
  name: z.string(),
  job: z.string().optional(),
});

const genreRawSchema = z.object({ id: z.number(), name: z.string() });
const companyRawSchema = z.object({ id: z.number(), name: z.string() });
const networkRawSchema = z.object({ id: z.number(), name: z.string() });
const countryRawSchema = z.object({ iso_3166_1: z.string(), name: z.string() });

const releaseDateEntrySchema = z.object({
  iso_3166_1: z.string(),
  release_dates: z.array(z.object({ certification: z.string().optional() })),
});

const contentRatingEntrySchema = z.object({
  iso_3166_1: z.string(),
  rating: z.string().optional(),
});

const collectionPartRawSchema = z.object({
  id: z.number(),
  title: z.string(),
  release_date: z.string().optional(),
});

// ─── Response schemas ────────────────────────────────────────────────────

const personPopularResponseSchema = z.object({
  page: z.number(),
  total_pages: z.number(),
  results: z.array(personRawSchema),
});

const personCreditsResponseSchema = z.object({
  cast: z.array(creditRawSchema).default([]),
  crew: z.array(creditRawSchema).default([]),
});

const collectionResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  overview: z.string(),
  parts: z.array(collectionPartRawSchema),
});

const movieKeySampleSchema = z.object({ id: z.number(), title: z.string() });

const keywordsObjSchema = z.object({ keywords: z.array(z.object({ id: z.number() })).default([]) });
const tvKeywordsObjSchema = z.object({ results: z.array(z.object({ id: z.number() })).default([]) });

const movieDetailsSchema = z.object({
  id: z.number(),
  genres: z.array(genreRawSchema).default([]),
  production_companies: z.array(companyRawSchema).default([]),
  production_countries: z.array(countryRawSchema).default([]),
  release_date: z.string().optional(),
  credits: z
    .object({
      cast: z.array(castRawSchema).default([]),
      crew: z.array(crewRawSchema).default([]),
    })
    .optional(),
  release_dates: z.object({ results: z.array(releaseDateEntrySchema).default([]) }).optional(),
  keywords: keywordsObjSchema.optional(),
});

const tvDetailsSchema = z.object({
  id: z.number(),
  genres: z.array(genreRawSchema).default([]),
  production_companies: z.array(companyRawSchema).default([]),
  production_countries: z.array(countryRawSchema).default([]).optional(),
  origin_country: z.array(z.string()).default([]).optional(),
  networks: z.array(networkRawSchema).default([]),
  first_air_date: z.string().optional(),
  credits: z
    .object({
      cast: z.array(castRawSchema).default([]),
      crew: z.array(crewRawSchema).default([]),
    })
    .optional(),
  aggregate_credits: z
    .object({
      cast: z.array(castRawSchema).default([]),
      crew: z.array(crewRawSchema).default([]),
    })
    .optional(),
  content_ratings: z.object({ results: z.array(contentRatingEntrySchema).default([]) }).optional(),
  keywords: tvKeywordsObjSchema.optional(),
});

// ─── Public types ────────────────────────────────────────────────────────

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

export interface TmdbItemDetails {
  id: number;
  mediaType: "movie" | "tv";
  genres: Array<{ id: number; name: string }>;
  productionCompanies: Array<{ id: number; name: string }>;
  productionCountries: Array<{ code: string; name: string }>;
  /** TV only. */
  networks: Array<{ id: number; name: string }>;
  /** Top-billed cast in cast.order ascending. Movies + TV (movies = full top billing; TV = aggregate). */
  cast: Array<{ id: number; name: string; order?: number }>;
  /** Crew with job=Director (movies) or aggregate-credits crew Director (TV). */
  directors: Array<{ id: number; name: string }>;
  /** Map of ISO-3166-1 region -> certification. */
  contentRatings: Record<string, string>;
  /** TMDb keyword IDs assigned to the title. */
  keywords: number[];
  /** Calendar month of release / first air date (1–12), undefined when TMDb has no date. */
  releaseMonth?: number;
}

// ─── Core fetch helper ───────────────────────────────────────────────────

async function tmdbFetch<S extends z.ZodTypeAny>(
  cfg: TmdbConfig,
  path: string,
  schema: S,
  params: Record<string, string> = {},
): Promise<z.infer<S>> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = (await tmdbQueue.add(() =>
      httpRequest({
        url,
        timeoutMs: 15_000,
        // Idempotent GET. A single 502 from TMDB at 01:00 used to fail the whole
        // nightly generate, with no job-level retry behind it.
        retries: 2,
        // TMDb error bodies are ~100 chars, but keep headroom so the JSON we
        // parse the status_code out of is never truncated mid-object.
        errorBodyMaxLen: 500,
        init: {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${cfg.apiKey}`,
          },
        },
      }),
    )) as Response;
  } catch (err) {
    if (err instanceof HttpError) throw tmdbErrorFrom(err, path);
    throw err;
  }
  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`TMDb ${path} response failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function yearFromDate(d?: string): number | undefined {
  if (!d) return undefined;
  const m = d.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}

function monthFromDate(d?: string): number | undefined {
  if (!d) return undefined;
  const m = d.match(/^\d{4}-(\d{2})/);
  if (!m) return undefined;
  const month = parseInt(m[1], 10);
  return month >= 1 && month <= 12 ? month : undefined;
}

function pickMovieCertification(entries: z.infer<typeof releaseDateEntrySchema>[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const cert = entry.release_dates.find((r) => r.certification && r.certification.trim().length > 0)?.certification;
    if (cert) out[entry.iso_3166_1] = cert.trim();
  }
  return out;
}

function pickTvCertification(entries: z.infer<typeof contentRatingEntrySchema>[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.rating && entry.rating.trim().length > 0) out[entry.iso_3166_1] = entry.rating.trim();
  }
  return out;
}

/** ISO-3166-1 alpha-2 -> human label (subset; falls back to code). */
const COUNTRY_LABELS: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  FR: "France",
  DE: "Germany",
  JP: "Japan",
  KR: "South Korea",
  CN: "China",
  IN: "India",
  IT: "Italy",
  ES: "Spain",
  MX: "Mexico",
  BR: "Brazil",
  RU: "Russia",
  IE: "Ireland",
  NZ: "New Zealand",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  NL: "Netherlands",
  BE: "Belgium",
  PL: "Poland",
  TR: "Turkey",
  HK: "Hong Kong",
  TW: "Taiwan",
};

// ─── Public API ──────────────────────────────────────────────────────────

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
    const data = await tmdbFetch(cfg, "/person/popular", personPopularResponseSchema, { page: String(page) });
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
    const data = await tmdbFetch(cfg, path, personCreditsResponseSchema);
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

export async function fetchCollection(cfg: TmdbConfig, collectionId: number): Promise<TmdbCollection> {
  const data = await tmdbFetch(cfg, `/collection/${collectionId}`, collectionResponseSchema);
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
  const data = await tmdbFetch({ apiKey }, "/movie/550", movieKeySampleSchema);
  return { ok: true, sample: data.title };
}

/**
 * Fetch a movie or show with everything needed for grouped collection rules
 * (genres, companies, countries, networks, top-billed cast, directors,
 * regional certifications). Single API call per item via append_to_response.
 */
export async function fetchItemDetails(
  cfg: TmdbConfig,
  tmdbId: number,
  mediaType: "movie" | "tv",
): Promise<TmdbItemDetails> {
  if (mediaType === "movie") {
    const data = await tmdbFetch(cfg, `/movie/${tmdbId}`, movieDetailsSchema, {
      append_to_response: "credits,release_dates,keywords",
    });
    const cast = (data.credits?.cast ?? [])
      .map((c) => ({ id: c.id, name: c.name, order: c.order }))
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    const directors = (data.credits?.crew ?? [])
      .filter((c) => c.job === "Director")
      .map((c) => ({ id: c.id, name: c.name }));
    return {
      id: data.id,
      mediaType: "movie",
      genres: data.genres,
      productionCompanies: data.production_companies,
      productionCountries: data.production_countries.map((c) => ({ code: c.iso_3166_1, name: c.name })),
      networks: [],
      cast,
      directors,
      contentRatings: pickMovieCertification(data.release_dates?.results ?? []),
      keywords: (data.keywords?.keywords ?? []).map((k) => k.id),
      releaseMonth: monthFromDate(data.release_date),
    };
  }

  const data = await tmdbFetch(cfg, `/tv/${tmdbId}`, tvDetailsSchema, {
    append_to_response: "aggregate_credits,content_ratings,keywords",
  });
  const credits = data.aggregate_credits ?? data.credits ?? { cast: [], crew: [] };
  const cast = credits.cast
    .map((c) => ({ id: c.id, name: c.name, order: c.order }))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const directors = credits.crew
    .filter((c) => c.job === "Director" || c.job === "Series Director")
    .map((c) => ({ id: c.id, name: c.name }));
  const productionCountries =
    data.production_countries && data.production_countries.length > 0
      ? data.production_countries.map((c) => ({ code: c.iso_3166_1, name: c.name }))
      : (data.origin_country ?? []).map((code) => ({ code, name: COUNTRY_LABELS[code] ?? code }));
  return {
    id: data.id,
    mediaType: "tv",
    genres: data.genres,
    productionCompanies: data.production_companies,
    productionCountries,
    networks: data.networks,
    cast,
    directors,
    contentRatings: pickTvCertification(data.content_ratings?.results ?? []),
    keywords: (data.keywords?.results ?? []).map((k) => k.id),
    releaseMonth: monthFromDate(data.first_air_date),
  };
}
