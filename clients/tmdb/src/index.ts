/**
 * Minimal TMDb client. Used for popular-people, franchise-collection,
 * grouped-rule (studios/networks/genres/...) lookups, and Discover search.
 *
 * Auth: TMDb's /3 endpoints accept the API key as either `?api_key=…` or
 * `Authorization: Bearer …`. We use the header form so the key never lands
 * in HTTP access logs / proxy logs / browser history. Both v3 (32-hex) keys
 * and v4 read-access tokens work over Bearer.
 *
 * Validation: all responses pass through Zod parsers. The API has a habit of
 * returning unexpected nulls and occasionally adding fields, so we declare
 * what we use and let unknown fields fall away.
 *
 * The transport itself lives in `_shared.ts`, so `search.ts` can reuse it.
 */

import { z } from "zod";
import { tmdbFetch, yearFromDate, monthFromDate, type TmdbConfig } from "./_shared.ts";

export { TmdbError, type TmdbConfig } from "./_shared.ts";
export * from "./search.ts";
export * from "./keywords.ts";

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

// ─── Helpers ─────────────────────────────────────────────────────────────

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
