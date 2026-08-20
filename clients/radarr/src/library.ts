/**
 * The movie library: reading it, adding to it, changing it, removing from it.
 */

import type { ServarrHttp } from "@tinkerbell/servarr-http";
import { parseExternalId } from "@tinkerbell/servarr-http";
import type { RadarrMovie, RadarrMovieFile, RadarrRaw } from "./types.ts";

/**
 * How long to allow for a whole-library GET.
 *
 * There is no paged movie endpoint — `GET /movie` returns every record in one
 * response, which is tens of megabytes and several seconds on a large install.
 * The default 15s deadline is not enough and a timeout here looks exactly like
 * an unreachable server.
 */
const FULL_LIBRARY_TIMEOUT_MS = 120_000;

export function toMovie(row: RadarrRaw): RadarrMovie {
  return {
    ...(row as unknown as RadarrMovie),
    id: row.id as number,
    title: (row.title as string) ?? "",
    monitored: row.monitored === true,
    hasFile: row.hasFile === true,
    raw: row,
  };
}

export interface AddMovieOptions {
  qualityProfileId: number;
  rootFolderPath: string;
  monitor: boolean;
  searchOnAdd: boolean;
  minimumAvailability?: string;
  tags?: number[];
}

export interface AddMovieResult {
  status: "added" | "exists" | "failed";
  id?: number;
  title?: string;
  error?: string;
}

export interface DeleteMovieOptions {
  deleteFiles: boolean;
  /**
   * Add to Radarr's import exclusion list, so an import list that still
   * contains the movie doesn't re-add it on the next sync.
   */
  addImportExclusion: boolean;
}

export interface MovieEditorOptions {
  movieIds: number[];
  monitored?: boolean;
  qualityProfileId?: number;
  rootFolderPath?: string;
  minimumAvailability?: string;
  tags?: number[];
  /** add | remove | replace — required whenever `tags` is given. */
  applyTags?: "add" | "remove" | "replace";
  moveFiles?: boolean;
}

export function createLibrary(http: ServarrHttp) {
  async function movies(): Promise<RadarrMovie[]> {
    const rows = await http.get<RadarrRaw[]>("/movie", { timeoutMs: FULL_LIBRARY_TIMEOUT_MS });
    return (rows ?? []).map(toMovie);
  }

  async function movie(id: number): Promise<RadarrMovie | null> {
    const row = await http.get<RadarrRaw | null>(`/movie/${id}`);
    return row ? toMovie(row) : null;
  }

  /**
   * Find a movie **already in the library** by external id.
   *
   * Distinct from `lookup`, which searches TMDb for something to add: that
   * returns a candidate with no `id`, and every mutation endpoint needs the
   * library record. Deleting the wrong thing because a search result was
   * mistaken for a library row is exactly the failure this separation prevents.
   */
  async function findByExternalId(externalId: string): Promise<RadarrMovie | null> {
    const parsed = parseExternalId(externalId);
    if (!parsed) return null;

    // Radarr indexes the whole movie list by tmdbId server-side, so this is a
    // real filter rather than a full download. There is no equivalent for imdb.
    if (parsed.scheme === "tmdb") {
      const rows = await http.get<RadarrRaw[]>("/movie", { params: { tmdbId: parsed.value } });
      const first = rows?.[0];
      return first ? toMovie(first) : null;
    }
    if (parsed.scheme === "imdb") {
      const all = await http.get<RadarrRaw[]>("/movie", { timeoutMs: FULL_LIBRARY_TIMEOUT_MS });
      const hit = all?.find((m) => m.imdbId === parsed.value);
      return hit ? toMovie(hit) : null;
    }
    // A tvdb id names a series. Radarr has nothing to answer with, and
    // guessing by title is how you delete the wrong film.
    return null;
  }

  /** Search TMDb for something to add. `term` is free text or `tmdb:N` / `imdb:ttN`. */
  async function lookup(term: string): Promise<RadarrMovie[]> {
    const rows = await http.get<RadarrRaw[]>("/movie/lookup", { params: { term }, timeoutMs: 30_000 });
    return (rows ?? []).map(toMovie);
  }

  /**
   * Add a looked-up movie.
   *
   * A 400 saying the movie is already present is a normal outcome, not a
   * failure — two rules can want the same film — so it is reported as
   * `exists` rather than thrown. That branch is why this goes through `raw()`.
   */
  async function addMovie(candidate: RadarrMovie, opts: AddMovieOptions): Promise<AddMovieResult> {
    const body = {
      ...candidate.raw,
      qualityProfileId: opts.qualityProfileId,
      rootFolderPath: opts.rootFolderPath,
      monitored: opts.monitor,
      ...(opts.minimumAvailability ? { minimumAvailability: opts.minimumAvailability } : {}),
      ...(opts.tags ? { tags: opts.tags } : {}),
      addOptions: {
        searchForMovie: opts.searchOnAdd,
        monitor: opts.monitor ? "movieOnly" : "none",
      },
    };

    const res = await http.raw("POST", "/movie", body, { timeoutMs: 30_000 });
    if (res.ok) {
      const data = res.body ? (JSON.parse(res.body) as { id?: number; title?: string }) : {};
      return { status: "added", id: data.id, title: data.title };
    }
    if (res.status === 400 && /already.*been added|already exists/i.test(res.body)) {
      return { status: "exists", title: candidate.title };
    }
    return { status: "failed", error: `${res.status}${res.body ? `: ${res.body.slice(0, 200)}` : ""}` };
  }

  /**
   * Change a movie, safely.
   *
   * The signature takes a **mutator, never a record**, and re-reads the movie
   * itself immediately before writing. This is not ergonomic sugar — it is the
   * only defence against the sharpest edge in the whole API: Radarr's PUT
   * replaces the record wholesale and nulls every field the body omits. A
   * caller that passed a row from our mirror, synced six hours ago, would
   * silently revert every change made in Radarr since. There is deliberately
   * no overload that accepts a record, so the safe path is the only path.
   */
  async function updateMovie(
    id: number,
    mutate: (current: RadarrMovie) => RadarrRaw,
    opts: { moveFiles?: boolean } = {},
  ): Promise<RadarrMovie> {
    const current = await movie(id);
    if (!current) throw new Error(`Radarr: movie ${id} not found`);
    const body = mutate(current);
    const updated = await http.put<RadarrRaw>(`/movie/${id}`, body, {
      params: { moveFiles: opts.moveFiles ?? false },
      timeoutMs: 30_000,
    });
    return updated ? toMovie(updated) : current;
  }

  function setMonitored(id: number, monitored: boolean): Promise<RadarrMovie> {
    return updateMovie(id, (current) => ({ ...current.raw, monitored }));
  }

  /**
   * Bulk edit through Radarr's own editor endpoint.
   *
   * Strongly preferred over looping `updateMovie`: one request instead of
   * 2N, and Radarr applies the change itself rather than trusting N
   * round-tripped record bodies — which is N chances to clobber.
   */
  async function editor(opts: MovieEditorOptions): Promise<RadarrMovie[]> {
    const rows = await http.put<RadarrRaw[]>("/movie/editor", opts, { timeoutMs: 60_000 });
    return (rows ?? []).map(toMovie);
  }

  async function deleteMovie(id: number, opts: DeleteMovieOptions): Promise<void> {
    await http.del(`/movie/${id}`, {
      params: {
        deleteFiles: opts.deleteFiles,
        addImportExclusion: opts.addImportExclusion,
      },
    });
  }

  /**
   * Bulk delete through the editor endpoint — a `DELETE` carrying a body.
   *
   * Same exclusion semantics as the single-record path, and preferred for the
   * same reason as `editor`: one request, and Radarr decides what "delete
   * these twelve" means rather than us issuing twelve chances to get it wrong.
   */
  async function deleteMovies(movieIds: number[], opts: DeleteMovieOptions): Promise<void> {
    await http.del("/movie/editor", {
      body: {
        movieIds,
        deleteFiles: opts.deleteFiles,
        addImportExclusion: opts.addImportExclusion,
      },
      timeoutMs: 60_000,
    });
  }

  async function files(movieId: number): Promise<RadarrMovieFile[]> {
    return (await http.get<RadarrMovieFile[]>("/moviefile", { params: { movieId } })) ?? [];
  }

  async function deleteFile(fileId: number): Promise<void> {
    await http.del(`/moviefile/${fileId}`);
  }

  return {
    movies,
    movie,
    findByExternalId,
    lookup,
    addMovie,
    updateMovie,
    setMonitored,
    editor,
    deleteMovie,
    deleteMovies,
    files,
    deleteFile,
  };
}
