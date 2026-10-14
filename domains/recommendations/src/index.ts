/**
 * The bundled recommender: ranks a library for a person, or against one title,
 * from item vectors trained offline in `ml/`.
 *
 * Why it exists: Because You Watched and We Think You'd Like used to paste the
 * whole library into an LLM prompt, which needed a context window big enough
 * for it (`fitLibrary` cut it down when one wasn't), matched answers back by
 * title (and the model got years wrong), and could not run at all without an
 * AI provider. This ranks the library locally; the LLM, when there is one,
 * only reranks a short list.
 *
 * Personalisation is a fold-in, not training: a person's vector is solved
 * against the fixed item vectors from their weighted history (the iALS normal
 * equations), which is what the offline eval measured as best — a plain
 * weighted mean of watched titles' vectors scored a third lower.
 *
 * Every entry point returns `null` for "can't help, use the old path": the
 * feature is off, the image has no model, or too little of the library has
 * vectors to rank it fairly. Callers must never treat `null` as "no picks".
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { token } from "@tinkerbell/container";
import { createLogger, errorMessage, type ConfigStore } from "@tinkerbell/core";
import { mediaItems, type Db } from "@tinkerbell/db";
import { dot, norm, solveSpd } from "./linalg.ts";
import { parseModel, type Model, type ModelHeader } from "./model.ts";

export { parseModel, SUPPORTED_FORMAT, type Model, type ModelHeader } from "./model.ts";
export { solveSpd } from "./linalg.ts";

const log = createLogger("recommendations");

/**
 * Below this share of candidates with a vector, a ranking would quietly favour
 * whatever happens to be covered — the uncovered titles can never be picked —
 * so the caller is told to fall back instead.
 */
export const MIN_COVERAGE = 0.6;
const CHUNK = 500;

/**
 * Where the model lives: `/app/models/recs.bin` in the image (the repo root is
 * `/app`), `models/recs.bin` in a checkout — fetched by
 * `scripts/fetch-recs-model.mjs`, never committed.
 */
export function modelPath(): string {
  return process.env.RECS_MODEL_PATH || join(import.meta.dirname, "..", "..", "..", "models", "recs.bin");
}

export interface WeightedTitle {
  ratingKey: string;
  /** `titleWeight` from WTYL's profile: recency × plays × completion; negative for a title given up on. */
  weight: number;
}

export interface RecommenderStatus {
  enabled: boolean;
  /** The image (or checkout) has a readable model. */
  available: boolean;
  error?: string;
  model?: Pick<ModelHeader, "version" | "count" | "sources" | "attribution">;
}

export interface RecommendationsDeps {
  db: Db;
  config: ConfigStore;
  /** Tests point this at a fixture; production reads `modelPath()`. */
  modelPath?: string;
}

export function createRecommendations(deps: RecommendationsDeps) {
  const { db } = deps;
  let loaded: { model: Model } | { error: string } | undefined;

  /** Read once per process, on first use: ~25MB that most processes never need. */
  function model(): Model | null {
    if (!loaded) {
      const path = deps.modelPath ?? modelPath();
      if (!existsSync(path)) {
        loaded = { error: "This build of Tinkerbell doesn't include the recommender model." };
      } else {
        try {
          loaded = { model: parseModel(readFileSync(path)) };
        } catch (err) {
          log.warn(`couldn't read the recommender model at ${path}: ${errorMessage(err)}`);
          loaded = { error: `The recommender model couldn't be read: ${errorMessage(err)}` };
        }
      }
    }
    return "model" in loaded ? loaded.model : null;
  }

  function enabled(): boolean {
    return deps.config.getConfig("recommender_enabled") === true;
  }

  function status(): RecommenderStatus {
    const m = model();
    if (!m) return { enabled: enabled(), available: false, error: (loaded as { error: string }).error };
    const { version, count, sources, attribution } = m.header;
    return { enabled: enabled(), available: true, model: { version, count, sources, attribution } };
  }

  /** ratingKey → model row, for the keys that have a vector. Shows map to their `tv:` id. */
  function rowsFor(m: Model, ratingKeys: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (let i = 0; i < ratingKeys.length; i += CHUNK) {
      const rows = db
        .select({ ratingKey: mediaItems.ratingKey, type: mediaItems.type, tmdbId: mediaItems.tmdbId })
        .from(mediaItems)
        .where(inArray(mediaItems.ratingKey, ratingKeys.slice(i, i + CHUNK)))
        .all();
      for (const r of rows) {
        if (r.tmdbId == null) continue;
        const row = m.rows.get(`${r.type === "show" ? "tv" : "movie"}:${r.tmdbId}`);
        if (row !== undefined) out.set(r.ratingKey, row);
      }
    }
    return out;
  }

  /** The model and candidate rows, or null — with the reason logged — when the old path should run. */
  function prepare(candidates: string[], what: string) {
    if (!enabled()) return null;
    const m = model();
    if (!m || candidates.length === 0) return null;
    const rows = rowsFor(m, candidates);
    const coverage = rows.size / candidates.length;
    if (coverage < MIN_COVERAGE) {
      log.info(
        `${what}: only ${Math.round(coverage * 100)}% of ${candidates.length} titles have a vector; falling back to the unranked library`,
      );
      return null;
    }
    return { m, rows };
  }

  function topK(scored: Array<[string, number]>, limit: number): string[] {
    return scored
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k]) => k);
  }

  /**
   * A person's taste vector, folded in against the fixed item vectors:
   * (YᵀY + Yᵀ(C−I)Y + λI) u = YᵀCp. A liked title is p=1; one given up on is
   * p=0 at high confidence, so it pushes the vector away instead of being
   * dropped. The same equations `ml/recs/als.py` evaluates.
   */
  function foldIn(m: Model, history: Array<{ row: number; weight: number }>): Float64Array {
    const { dims, regularization, alpha, foldInScale } = m.header;
    const a = Float64Array.from(m.gram);
    const b = new Float64Array(dims);
    const y = new Float64Array(dims);
    for (const { row, weight } of history) {
      m.vector(row, y);
      const c = 1 + alpha * foldInScale * Math.abs(weight);
      for (let i = 0; i < dims; i++) {
        const ci = (c - 1) * y[i]!;
        for (let j = 0; j < dims; j++) a[i * dims + j]! += ci * y[j]!;
        if (weight > 0) b[i]! += c * y[i]!;
      }
    }
    for (let i = 0; i < dims; i++) a[i * dims + i]! += regularization;
    return solveSpd(a, b, dims);
  }

  /**
   * The `limit` candidates that best fit this history, best first — WTYL's
   * shortlist. Candidates without a vector can't be scored and are left out;
   * that is what the coverage floor protects.
   */
  function shortlist(opts: { history: WeightedTitle[]; candidates: string[]; limit: number }): string[] | null {
    const ready = prepare(opts.candidates, "shortlist");
    if (!ready) return null;
    const { m, rows } = ready;
    const historyRows = rowsFor(
      m,
      opts.history.map((h) => h.ratingKey),
    );
    const history = opts.history.flatMap((h) => {
      const row = historyRows.get(h.ratingKey);
      return row === undefined || h.weight === 0 ? [] : [{ row, weight: h.weight }];
    });
    // Nothing they liked has a vector: a fold-in from only negatives (or
    // nothing) is the regulariser talking, not their taste.
    if (!history.some((h) => h.weight > 0)) return null;

    const u = foldIn(m, history);
    const y = new Float64Array(m.header.dims);
    return topK(
      [...rows].map(([key, row]) => [key, dot(m.vector(row, y), u)]),
      opts.limit,
    );
  }

  /**
   * The `limit` candidates most like `seed`, best first — BYW's shortlist.
   *
   * Scored as cosine × √length, not cosine. A title with a thin Wikidata
   * entry projects to roughly the average film, which points the same way as
   * popular films, so under cosine an obscure title read as close to
   * everything (Inception's third neighbour was *Tarantella*, 1990). Length is
   * how confident the vector is, and counting it pushes those out. Counted in
   * full (a plain dot product) it also ranks by popularity — The Matrix's
   * neighbours became Shawshank and Forrest Gump — so it is counted by half.
   * In `ml/recs/mixed.py`'s libraries of rated and rarely-rated films:
   *
   *   cosine      hit@20 0.128, tail 1.9% of the top 20, median popularity 6.1k
   *   × √length   hit@20 0.174, tail 0%,                 median popularity 9.2k
   *   dot         hit@20 0.191, tail 0%,                 median popularity 11.9k
   */
  function similar(opts: { seed: string; candidates: string[]; limit: number }): string[] | null {
    const ready = prepare(opts.candidates, "similar");
    if (!ready) return null;
    const { m, rows } = ready;
    const seedRow = rowsFor(m, [opts.seed]).get(opts.seed);
    if (seedRow === undefined) return null;
    const seed = m.vector(seedRow);
    const seedNorm = norm(seed) || 1;
    const y = new Float64Array(m.header.dims);
    return topK(
      [...rows]
        .filter(([key]) => key !== opts.seed)
        .map(([key, row]) => {
          m.vector(row, y);
          return [key, dot(y, seed) / (seedNorm * Math.sqrt(norm(y) || 1))];
        }),
      opts.limit,
    );
  }

  return { status, shortlist, similar };
}

export type Recommendations = ReturnType<typeof createRecommendations>;
export const RecommendationsToken = token<Recommendations>("recommendations");
