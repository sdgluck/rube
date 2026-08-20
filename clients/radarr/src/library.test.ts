import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createMockArr } from "./test-support.ts";
import { createRadarrClient } from "./index.ts";

const MOVIE = {
  id: 7,
  title: "The Matrix",
  year: 1999,
  tmdbId: 603,
  imdbId: "tt0133093",
  monitored: true,
  hasFile: true,
  qualityProfileId: 4,
  // A field this client does not model. It is here to prove the update path
  // round-trips it rather than dropping it — the clobbering guard.
  secretUpstreamField: "must survive",
};

describe("radarr library", () => {
  let mock: ReturnType<typeof createMockArr>;
  let url: string;

  beforeEach(async () => {
    mock = createMockArr();
    url = await mock.start();
  });
  afterEach(() => mock.stop());

  const client = () => createRadarrClient({ url, apiKey: "k" });

  it("reads the whole library", async () => {
    mock.on("GET /api/v3/movie", () => ({ body: [MOVIE] }));
    const movies = await client().movies();

    assert.equal(movies.length, 1);
    assert.equal(movies[0].title, "The Matrix");
    assert.equal(movies[0].hasFile, true);
    assert.equal(movies[0].raw.secretUpstreamField, "must survive");
  });

  it("uses Radarr's server-side tmdbId filter rather than downloading the library", async () => {
    mock.on("GET /api/v3/movie", (req) => ({ body: req.params.tmdbId === "603" ? [MOVIE] : [] }));

    const found = await client().findByExternalId("tmdb:603");
    assert.equal(found?.id, 7);
    assert.equal(mock.to("/api/v3/movie")[0].params.tmdbId, "603");
  });

  // Radarr has no server-side imdb filter, so this one legitimately walks the
  // whole list — the asymmetry is worth pinning so nobody "optimises" it away.
  it("falls back to a full walk for an imdb id", async () => {
    mock.on("GET /api/v3/movie", () => ({ body: [MOVIE] }));

    const found = await client().findByExternalId("imdb:tt0133093");
    assert.equal(found?.id, 7);
    assert.equal(mock.to("/api/v3/movie")[0].params.tmdbId, undefined);
  });

  // A tvdb id names a series. Radarr has nothing to answer with, and matching
  // by title instead is how you delete the wrong film.
  it("refuses to resolve a tvdb id and makes no request", async () => {
    assert.equal(await client().findByExternalId("tvdb:1234"), null);
    assert.equal(mock.requests.length, 0);
  });

  describe("updateMovie", () => {
    /**
     * The single most important test in this client.
     *
     * Radarr's PUT replaces the record wholesale and nulls whatever the body
     * omits. `updateMovie` therefore re-reads immediately before writing, and
     * takes a mutator rather than a record so a caller *cannot* hand it a
     * stale row from the mirror.
     */
    it("re-reads the record before writing", async () => {
      mock.on("GET /api/v3/movie/7", () => ({ body: MOVIE }));
      mock.on("PUT /api/v3/movie/7", (req) => ({ body: req.body }));

      await client().setMonitored(7, false);

      assert.deepEqual(
        mock.requests.map((r) => `${r.method} ${r.path}`),
        ["GET /api/v3/movie/7", "PUT /api/v3/movie/7"],
      );
    });

    it("round-trips fields the client does not model", async () => {
      mock.on("GET /api/v3/movie/7", () => ({ body: MOVIE }));
      mock.on("PUT /api/v3/movie/7", (req) => ({ body: req.body }));

      await client().setMonitored(7, false);

      const put = mock.to("/api/v3/movie/7")[1].body as Record<string, unknown>;
      assert.equal(put.secretUpstreamField, "must survive");
      assert.equal(put.qualityProfileId, 4);
      assert.equal(put.monitored, false);
    });

    it("does not move files unless asked", async () => {
      mock.on("GET /api/v3/movie/7", () => ({ body: MOVIE }));
      mock.on("PUT /api/v3/movie/7", (req) => ({ body: req.body }));

      await client().setMonitored(7, false);
      assert.equal(mock.to("/api/v3/movie/7")[1].params.moveFiles, "false");
    });

    it("fails loudly when the record has gone", async () => {
      mock.on("GET /api/v3/movie/7", () => ({ status: 404, body: [] }));
      await assert.rejects(() => client().setMonitored(7, false));
    });
  });

  describe("addMovie", () => {
    const candidate = { ...MOVIE, id: 0, raw: MOVIE } as never;

    it("reports an added movie", async () => {
      mock.on("POST /api/v3/movie", () => ({ status: 201, body: { id: 9, title: "The Matrix" } }));

      const res = await client().addMovie(candidate, {
        qualityProfileId: 4,
        rootFolderPath: "/movies",
        monitor: true,
        searchOnAdd: true,
      });
      assert.deepEqual(res, { status: "added", id: 9, title: "The Matrix" });
    });

    // Two rules can want the same film. That is a normal outcome, not an error,
    // and treating it as one would make every second run look like a failure.
    it("treats already-added as `exists`, not a failure", async () => {
      mock.on("POST /api/v3/movie", () => ({
        status: 400,
        body: [{ errorMessage: "This movie has already been added" }],
      }));

      const res = await client().addMovie(candidate, {
        qualityProfileId: 4,
        rootFolderPath: "/movies",
        monitor: true,
        searchOnAdd: false,
      });
      assert.equal(res.status, "exists");
    });

    it("reports any other 400 as a failure", async () => {
      mock.on("POST /api/v3/movie", () => ({
        status: 400,
        body: [{ propertyName: "rootFolderPath", errorMessage: "Path does not exist" }],
      }));

      const res = await client().addMovie(candidate, {
        qualityProfileId: 4,
        rootFolderPath: "/nope",
        monitor: true,
        searchOnAdd: false,
      });
      assert.equal(res.status, "failed");
      assert.match(res.error!, /Path does not exist/);
    });

    it("sends the search and monitor options Radarr expects", async () => {
      mock.on("POST /api/v3/movie", () => ({ status: 201, body: { id: 9 } }));

      await client().addMovie(candidate, {
        qualityProfileId: 4,
        rootFolderPath: "/movies",
        monitor: false,
        searchOnAdd: true,
      });

      const body = mock.to("/api/v3/movie")[0].body as Record<string, unknown>;
      assert.deepEqual(body.addOptions, { searchForMovie: true, monitor: "none" });
      assert.equal(body.monitored, false);
    });
  });

  describe("deleteMovie", () => {
    it("sends both delete flags", async () => {
      mock.on("DELETE /api/v3/movie/7", () => ({ status: 200, body: undefined }));

      await client().deleteMovie(7, { deleteFiles: true, addImportExclusion: true });

      assert.deepEqual(mock.to("/api/v3/movie/7")[0].params, {
        deleteFiles: "true",
        addImportExclusion: "true",
      });
    });

    // An empty 200 used to throw out of JSON.parse *after* the file was gone,
    // so the caller saw a failure and retried the delete forever.
    it("tolerates an empty 200 body", async () => {
      mock.on("DELETE /api/v3/movie/7", () => ({ status: 200, body: undefined }));
      await client().deleteMovie(7, { deleteFiles: true, addImportExclusion: false });
    });

    it("bulk-deletes through the editor endpoint with a body", async () => {
      mock.on("DELETE /api/v3/movie/editor", () => ({ status: 200, body: undefined }));

      await client().deleteMovies([1, 2, 3], { deleteFiles: false, addImportExclusion: true });

      assert.deepEqual(mock.to("/api/v3/movie/editor")[0].body, {
        movieIds: [1, 2, 3],
        deleteFiles: false,
        addImportExclusion: true,
      });
    });
  });

  it("bulk-edits through the editor endpoint rather than N updates", async () => {
    mock.on("PUT /api/v3/movie/editor", () => ({ body: [] }));

    await client().editor({ movieIds: [1, 2], qualityProfileId: 9 });

    assert.equal(mock.requests.length, 1);
    assert.deepEqual(mock.to("/api/v3/movie/editor")[0].body, { movieIds: [1, 2], qualityProfileId: 9 });
  });
});
