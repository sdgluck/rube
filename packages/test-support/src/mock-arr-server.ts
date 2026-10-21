/**
 * A stateful Radarr or Sonarr, over real HTTP.
 *
 * Same reasoning as the mock Plex: the interesting failures in the *Arr client
 * are on the wire, not in the branching. In particular this answers `DELETE`
 * with **200 and an empty body**, which is what some Radarr versions actually
 * do and what used to throw inside `arrFetch` *after* the file was already
 * gone — leaving the item un-actioned and retried forever.
 *
 * It records the query string verbatim, so a test can assert that
 * `deleteFiles` and the exclusion flags went out as configured rather than
 * trusting that they were assembled correctly.
 *
 * Moved here from `packages/jobs/src/test-support` once `clients/arr` needed it
 * too. It grew three things in the move:
 *
 * - **Sonarr.** Half of `clients/arr` branches on the service, and the Sonarr
 *   half — `/api/v3/series`, `statistics.episodeFileCount` standing in for
 *   `hasFile` — had no way to be exercised at all.
 * - **Fault injection** (`failNext`, `failWith`). The client's most important
 *   property is that it does *not* retry a mutation, and you cannot assert a
 *   negative without a first attempt that fails.
 * - **A full record journal** for PUTs rather than just `{ id, monitored }`, so
 *   a test can assert that a monitor toggle preserved the rest of the row.
 *   Both *Arrs replace the row wholesale, so a PUT that drops a field nulls it.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { customFormatSchemaFixture, qualityDefinitionsFixture, qualityProfileSchemaFixture } from "./arr-fixtures.ts";

export interface MockMovie {
  id: number;
  title: string;
  tmdbId: number;
  imdbId?: string;
  monitored: boolean;
  hasFile: boolean;
  /** Anything else the real row carries. Echoed back, so a PUT can drop it. */
  [extra: string]: unknown;
}

export interface MockSeries {
  id: number;
  title: string;
  tvdbId: number;
  imdbId?: string;
  tmdbId?: number;
  monitored: boolean;
  statistics?: { episodeFileCount?: number };
  [extra: string]: unknown;
}

export type MockArrRecord = MockMovie | MockSeries;

/** A Sonarr episode, as `GET /episode?seriesId=` serves it. */
export interface MockEpisode {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  hasFile: boolean;
  monitored?: boolean;
  /** Two episodes sharing one is a multi-episode file. */
  episodeFileId?: number;
}

export interface ArrJournal {
  /** Full `path?query` of every delete, so flags can be asserted. */
  deletes: string[];
  /** `{ id, monitored }` per monitor toggle. */
  monitorWrites: Array<{ id: number; monitored: boolean }>;
  /** The complete body of every PUT, to catch a write that dropped a field. */
  puts: Array<{ id: number; body: Record<string, unknown> }>;
  /** Every POST to the add endpoint. */
  adds: Array<Record<string, unknown>>;
  lookups: string[];
  /**
   * Every write to the quality settings endpoints, in order, as
   * `METHOD path` plus the body. Ordering is the thing worth asserting: a
   * profile that references a custom format must be written after it.
   */
  settingsWrites: Array<{ method: string; path: string; body: unknown }>;
  unhandled: string[];
  /** Radarr only: every release grabbed, as posted. */
  grabs: Array<Record<string, unknown>>;
  /** Every `POST /command` body. */
  commands: Array<Record<string, unknown>>;
  /** History ids marked failed, by `POST /history/failed/:id`. */
  failedHistory: number[];
  /** Every request, in order, as `METHOD path`. */
  requests: string[];
}

export interface MockArr {
  origin: string;
  journal: ArrJournal;
  /** Live library state, keyed by *Arr id. */
  records: Map<number, MockArrRecord>;
  /**
   * The same Map under its Radarr name.
   *
   * `records` is the honest name now that this serves Sonarr too, but the
   * existing Radarr tests read `movies` and there is no sense in a rename that
   * only makes a diff.
   */
  movies: Map<number, MockArrRecord>;
  /**
   * Fail the next `n` requests with `status` before behaving normally again.
   *
   * The point is asserting that a mutation is *not* retried: without a way to
   * make the first attempt fail, "exactly one DELETE reached the server" is
   * indistinguishable from "the retry happened to succeed first time".
   */
  failNext: (n: number, status?: number, body?: string) => void;
  /** Answer every request to `path` with this status until cleared. */
  failWith: (path: string, status: number, body?: string) => void;
  /** Live quality settings, mutable by a test to simulate an edit made in the *Arr's own UI. */
  quality: MockQualityState;
  /** Radarr only: grabs, the queue and imports. */
  pipeline: MockRadarrPipeline;
  close: () => Promise<void>;
}

/**
 * Quality profiles, custom formats and quality definitions, stateful.
 *
 * Added for the preset planner, whose whole job is reading these, diffing
 * them and writing them back in the right order. A static answer could not
 * show that a second plan after an apply is empty, nor that a drift check
 * notices an edit made behind Rube's back.
 */
export interface MockQualityState {
  profiles: Map<number, Record<string, unknown>>;
  customFormats: Map<number, Record<string, unknown>>;
  definitions: Array<Record<string, unknown>>;
}

/**
 * Radarr's grab → download → import pipeline, enough of it to drive a swap.
 *
 * Modelled on the real behaviour the 4K swap depends on, which was checked
 * against a live Radarr: a finished download that isn't an upgrade sits in
 * the queue as `importBlocked`, `GET /manualimport` still offers it (with the
 * rejection), and the `ManualImport` command replaces the movie's file
 * regardless. A test moves a download along with `finish` or `failDownload`.
 */
export interface MockRadarrPipeline {
  /** What an interactive search for a movie returns. */
  releases: Map<number, Array<Record<string, unknown>>>;
  /** The movie's file on disk, as `/moviefile?movieId=` serves it. */
  files: Map<number, Record<string, unknown>>;
  /** Grabbed releases, by download id. */
  downloads: Map<string, MockArrDownload>;
  /** Mark a download complete; it becomes `importBlocked` with Radarr's "not an upgrade" message. */
  finish: (downloadId: string) => void;
  failDownload: (downloadId: string, message: string) => void;
}

export interface MockArrDownload {
  id: number;
  downloadId: string;
  movieId: number;
  title: string;
  quality: Record<string, unknown>;
  size: number;
  trackedDownloadState: string;
  status: string;
  errorMessage?: string;
}

export interface MockArrExtra {
  /** What a lookup-by-term returns. Defaults to nothing found. */
  lookupResults?: Array<Record<string, unknown>>;
  /** What `/system/status` reports. Sonarr "3.0.10" switches custom formats off. */
  version?: string;
  /** Model an install whose custom format schema predates `SizeSpecification`. */
  withoutSizeSpecification?: boolean;
  /** Sonarr only: the episodes `GET /episode?seriesId=` returns. */
  episodes?: MockEpisode[];
}

interface Options extends MockArrExtra {
  service: "radarr" | "sonarr";
  initial: MockArrRecord[];
}

function startMockArr(opts: Options): Promise<MockArr> {
  const { service } = opts;
  const collection = service === "radarr" ? "movie" : "series";
  const records = new Map(opts.initial.map((r) => [r.id, { ...r }]));
  const journal: ArrJournal = {
    deletes: [],
    monitorWrites: [],
    puts: [],
    adds: [],
    lookups: [],
    settingsWrites: [],
    unhandled: [],
    failedHistory: [],
    grabs: [],
    commands: [],
    requests: [],
  };

  // Seeded with the two profiles the older tests expect.
  const quality: MockQualityState = {
    profiles: new Map<number, Record<string, unknown>>([
      [1, { id: 1, name: "HD-1080p", extra: "ignored" }],
      [2, { id: 2, name: "Ultra-HD" }],
    ]),
    customFormats: new Map(),
    definitions: qualityDefinitionsFixture(service),
  };
  const fixtures = {
    profileSchema: qualityProfileSchemaFixture(service),
    customFormatSchema: customFormatSchemaFixture(service, { withoutSize: opts.withoutSizeSpecification }),
    supportsCustomFormats: !(service === "sonarr" && /^[0-3]\./.test(opts.version ?? "")),
  };

  const pipeline: MockRadarrPipeline = {
    releases: new Map(),
    files: new Map(),
    downloads: new Map(),
    finish(downloadId) {
      const d = pipeline.downloads.get(downloadId);
      if (d) Object.assign(d, { trackedDownloadState: "importBlocked", status: "completed" });
    },
    failDownload(downloadId, message) {
      const d = pipeline.downloads.get(downloadId);
      if (d) Object.assign(d, { trackedDownloadState: "failedPending", status: "failed", errorMessage: message });
    },
  };
  const commands = new Map<number, Record<string, unknown>>();

  let failuresRemaining = 0;
  let failureStatus = 500;
  let failureBody = "";
  const pathFailures = new Map<string, { status: number; body: string }>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();
    journal.requests.push(`${method} ${path}`);

    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    const readJson = (then: (body: Record<string, unknown>) => void) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
        } catch {
          // The test asserts on the journal.
        }
        then(parsed);
      });
    };

    function handlePipeline(): boolean {
      const movieId = Number(url.searchParams.get("movieId"));

      if (path === "/api/v3/moviefile" && method === "GET") {
        const file = pipeline.files.get(movieId);
        json(file ? [file] : []);
        return true;
      }

      if (path === "/api/v3/release" && method === "GET") {
        json(pipeline.releases.get(movieId) ?? []);
        return true;
      }

      if (path === "/api/v3/release" && method === "POST") {
        readJson((release) => {
          journal.grabs.push(release);
          const owner = [...pipeline.releases].find(([, rs]) => rs.some((r) => r.guid === release.guid));
          const downloadId = `DL${pipeline.downloads.size + 1}`;
          pipeline.downloads.set(downloadId, {
            id: pipeline.downloads.size + 1,
            downloadId,
            movieId: owner?.[0] ?? 0,
            title: String(release.title),
            quality: (release.quality as Record<string, unknown>) ?? {},
            size: Number(release.size ?? 0),
            trackedDownloadState: "downloading",
            status: "downloading",
          });
          json(release);
        });
        return true;
      }

      if (path === "/api/v3/queue/details" && method === "GET") {
        json(
          [...pipeline.downloads.values()]
            .filter((d) => d.movieId === movieId)
            .map((d) => ({
              ...d,
              sizeleft: d.status === "downloading" ? d.size / 2 : 0,
              statusMessages:
                d.trackedDownloadState === "importBlocked"
                  ? [{ title: d.title, messages: ["Not an upgrade for existing movie file."] }]
                  : [],
            })),
        );
        return true;
      }

      const queueId = /^\/api\/v3\/queue\/(\d+)$/.exec(path);
      if (queueId && method === "DELETE") {
        journal.deletes.push(`${path}${url.search}`);
        for (const [key, d] of pipeline.downloads) if (d.id === Number(queueId[1])) pipeline.downloads.delete(key);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end();
        return true;
      }

      if (path === "/api/v3/manualimport" && method === "GET") {
        const d = pipeline.downloads.get(url.searchParams.get("downloadId") ?? "");
        json(
          d && d.status === "completed"
            ? [
                {
                  path: `/downloads/${d.title}/${d.title}.mkv`,
                  size: d.size,
                  movie: { id: d.movieId },
                  quality: d.quality,
                  languages: [{ id: 1, name: "English" }],
                  releaseGroup: "GRP",
                  downloadId: d.downloadId,
                  rejections: [{ reason: "Not an upgrade for existing movie file." }],
                },
                // A sample alongside the film, which must not be what gets imported.
                { path: `/downloads/${d.title}/sample.mkv`, size: 1_000, movie: { id: d.movieId }, quality: d.quality },
              ]
            : [],
        );
        return true;
      }

      if (path === "/api/v3/command" && method === "POST") {
        readJson((body) => {
          journal.commands.push(body);
          const id = commands.size + 1;
          const command = { id, name: body.name, status: "completed", message: "" };
          if (body.name === "ManualImport") {
            for (const f of (body.files as Array<Record<string, unknown>>) ?? []) {
              const fileMovie = Number(f.movieId);
              const download = pipeline.downloads.get(String(f.downloadId));
              // Replaces whatever file the movie had, as the real one does.
              pipeline.files.set(fileMovie, {
                id: 100 + id,
                movieId: fileMovie,
                path: f.path,
                quality: f.quality,
                size: download?.size ?? 0,
              });
              if (download) pipeline.downloads.delete(download.downloadId);
            }
            command.message = "Manually imported 1 files";
          }
          commands.set(id, command);
          json(command, 201);
        });
        return true;
      }

      const commandId = /^\/api\/v3\/command\/(\d+)$/.exec(path);
      if (commandId && method === "GET") {
        json(commands.get(Number(commandId[1])) ?? { id: Number(commandId[1]), status: "failed" });
        return true;
      }

      return false;
    }

    const forced = pathFailures.get(path);
    if (forced) {
      res.writeHead(forced.status, { "Content-Type": "application/json" });
      res.end(forced.body);
      return;
    }

    if (failuresRemaining > 0) {
      failuresRemaining--;
      res.writeHead(failureStatus, { "Content-Type": "application/json" });
      res.end(failureBody);
      return;
    }

    if (path === "/api/v3/system/status") {
      json({
        instanceName: service === "radarr" ? "Mock Radarr" : "Mock Sonarr",
        version: opts.version ?? "5.0.0",
      });
      return;
    }

    if (handleQualitySettings({ req, method, path, quality, fixtures, journal, json })) return;

    if (service === "radarr" && handlePipeline()) return;

    if (path === "/api/v3/rootfolder") {
      json([{ id: 1, path: "/data/media", freeSpace: 1_000, accessible: true }]);
      return;
    }

    if (path === `/api/v3/${collection}/lookup`) {
      journal.lookups.push(`${path}${url.search}`);
      json(opts.lookupResults ?? []);
      return;
    }

    // Never mirrored by the real client, always asked per series — so it is
    // filtered here the way Sonarr filters it, not returned wholesale.
    if (service === "sonarr" && path === "/api/v3/episode" && method === "GET") {
      const seriesId = Number(url.searchParams.get("seriesId"));
      const season = url.searchParams.get("seasonNumber");
      json(
        (opts.episodes ?? [])
          .filter((e) => e.seriesId === seriesId && (season == null || e.seasonNumber === Number(season)))
          .map((e) => ({ monitored: true, ...e })),
      );
      return;
    }

    // ── The library ─────────────────────────────────────────────────────────
    if (path === `/api/v3/${collection}` && method === "GET") {
      journal.lookups.push(`${path}${url.search}`);
      const tmdbId = url.searchParams.get("tmdbId");
      const rows = [...records.values()].filter((r) => (tmdbId ? String(r.tmdbId) === tmdbId : true));
      json(rows);
      return;
    }

    if (path === `/api/v3/${collection}` && method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(body || "{}") as Record<string, unknown>;
        } catch {
          // Left empty on purpose — the test asserts on the journal.
        }
        journal.adds.push(parsed);

        const externalId = service === "radarr" ? parsed.tmdbId : parsed.tvdbId;
        const clash = [...records.values()].some((r) => (service === "radarr" ? r.tmdbId : r.tvdbId) === externalId);
        if (clash) {
          // The real 400 body, near enough: the client matches on the prose.
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify([{ errorMessage: "This movie has already been added" }]));
          return;
        }

        const id = Math.max(0, ...records.keys()) + 1;
        records.set(id, { ...(parsed as MockArrRecord), id });
        json({ id, title: parsed.title });
      });
      return;
    }

    const byId = new RegExp(`^/api/v3/${collection}/(\\d+)$`).exec(path);
    if (byId) {
      const id = Number(byId[1]);

      /**
       * Single-record read.
       *
       * Added when the add path started writing its result through to the
       * mirror: without it a `GET /movie/7` fell to the unhandled branch and
       * answered `[]`, which parses into a record with no id at all and
       * corrupts whatever stores it. A mock that answers the wrong shape is
       * worse than one that 404s.
       */
      if (method === "GET") {
        const record = records.get(id);
        if (!record) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end("{}");
          return;
        }
        json(record);
        return;
      }

      if (method === "DELETE") {
        journal.deletes.push(`${path}${url.search}`);
        records.delete(id);
        // 200 with no body — the shape that used to throw on res.json().
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end();
        return;
      }

      if (method === "PUT") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(body || "{}") as Record<string, unknown>;
          } catch {
            // A malformed body is the test's problem to notice, not a crash.
          }
          journal.puts.push({ id, body: parsed });
          journal.monitorWrites.push({ id, monitored: parsed.monitored === true });
          // Wholesale replacement, exactly as the real thing does — so a client
          // that PUTs a partial body loses whatever it left out.
          records.set(id, { ...(parsed as MockArrRecord), id });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end();
        });
        return;
      }
    }

    const failedHistory = path.match(/^\/api\/v3\/history\/failed\/(\d+)$/);
    if (failedHistory && method === "POST") {
      journal.failedHistory.push(Number(failedHistory[1]));
      json({});
      return;
    }

    journal.unhandled.push(`${method} ${path}`);
    json([]);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        journal,
        records,
        movies: records,
        quality,
        pipeline,
        failNext(n, status = 500, body = "") {
          failuresRemaining = n;
          failureStatus = status;
          failureBody = body;
        },
        failWith(path, status, body = "") {
          pathFailures.set(path, { status, body });
        },
        close: () => closeServer(server),
      });
    });
  });
}

export function startMockRadarr(initial: MockMovie[], extra?: MockArrExtra): Promise<MockArr> {
  return startMockArr({ service: "radarr", initial, ...extra });
}

export function startMockSonarr(initial: MockSeries[], extra?: MockArrExtra): Promise<MockArr> {
  return startMockArr({ service: "sonarr", initial, ...extra });
}

interface QualityRequest {
  req: IncomingMessage;
  method: string;
  path: string;
  quality: MockQualityState;
  fixtures: {
    profileSchema: Record<string, unknown>;
    customFormatSchema: Array<Record<string, unknown>>;
    supportsCustomFormats: boolean;
  };
  journal: ArrJournal;
  json: (body: unknown, status?: number) => void;
}

/** Answers the quality settings endpoints. Returns false for anything else. */
function handleQualitySettings(q: QualityRequest): boolean {
  const { method, path, quality, fixtures, journal, json } = q;

  const readBody = (then: (body: unknown) => void) => {
    let raw = "";
    q.req.on("data", (chunk) => (raw += chunk));
    q.req.on("end", () => {
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(raw || "{}");
      } catch {
        // The test asserts on the journal.
      }
      journal.settingsWrites.push({ method, path, body: parsed });
      then(parsed);
    });
  };

  const nextId = (m: Map<number, unknown>) => Math.max(0, ...m.keys()) + 1;

  /** The *Arr's own validation answer, near enough: a 400 with field failures. */
  const reject = (propertyName: string, errorMessage: string) => json([{ propertyName, errorMessage }], 400);

  if (path === "/api/v3/qualityprofile/schema" && method === "GET") {
    json(structuredClone(fixtures.profileSchema));
    return true;
  }

  if (path === "/api/v3/qualityprofile") {
    if (method === "GET") {
      json([...quality.profiles.values()]);
      return true;
    }
    if (method === "POST") {
      readBody((body) => {
        const profile = body as Record<string, unknown>;
        const clash = [...quality.profiles.values()].some((p) => p.name === profile.name);
        if (clash) return reject("Name", "Must be unique");
        const id = nextId(quality.profiles);
        quality.profiles.set(id, { ...profile, id });
        json({ ...profile, id }, 201);
      });
      return true;
    }
  }

  const profileById = /^\/api\/v3\/qualityprofile\/(\d+)$/.exec(path);
  if (profileById) {
    const id = Number(profileById[1]);
    if (method === "GET") {
      const profile = quality.profiles.get(id);
      if (profile) json(profile);
      else json({}, 404);
      return true;
    }
    if (method === "PUT") {
      readBody((body) => {
        if (!quality.profiles.has(id)) return json({}, 404);
        // Wholesale replacement, as the real thing does.
        quality.profiles.set(id, { ...(body as Record<string, unknown>), id });
        json({ ...(body as Record<string, unknown>), id }, 202);
      });
      return true;
    }
    if (method === "DELETE") {
      journal.settingsWrites.push({ method, path, body: null });
      quality.profiles.delete(id);
      json({});
      return true;
    }
  }

  if (path === "/api/v3/qualitydefinition" && method === "GET") {
    json(quality.definitions);
    return true;
  }

  if (path === "/api/v3/qualitydefinition/update" && method === "PUT") {
    readBody((body) => {
      for (const row of body as Array<Record<string, unknown>>) {
        const index = quality.definitions.findIndex((d) => d.id === row.id);
        if (index >= 0) quality.definitions[index] = { ...row };
      }
      json(quality.definitions, 202);
    });
    return true;
  }

  if (path.startsWith("/api/v3/customformat") && !fixtures.supportsCustomFormats) {
    // Sonarr v3 has no such resource.
    json({ message: "NotFound" }, 404);
    return true;
  }

  if (path === "/api/v3/customformat/schema" && method === "GET") {
    json(structuredClone(fixtures.customFormatSchema));
    return true;
  }

  if (path === "/api/v3/customformat") {
    if (method === "GET") {
      json([...quality.customFormats.values()]);
      return true;
    }
    if (method === "POST") {
      readBody((body) => {
        const format = body as Record<string, unknown>;
        const clash = [...quality.customFormats.values()].some((f) => f.name === format.name);
        if (clash) return reject("Name", "Must be unique");
        const supported = new Set(fixtures.customFormatSchema.map((s) => s.implementation));
        const specs = (format.specifications as Array<Record<string, unknown>> | undefined) ?? [];
        const unknown = specs.find((s) => !supported.has(s.implementation));
        if (unknown) return reject("Specifications", `Unknown implementation ${String(unknown.implementation)}`);
        const id = nextId(quality.customFormats);
        quality.customFormats.set(id, { ...format, id });
        json({ ...format, id }, 201);
      });
      return true;
    }
  }

  const formatById = /^\/api\/v3\/customformat\/(\d+)$/.exec(path);
  if (formatById) {
    const id = Number(formatById[1]);
    if (method === "PUT") {
      readBody((body) => {
        if (!quality.customFormats.has(id)) return json({}, 404);
        quality.customFormats.set(id, { ...(body as Record<string, unknown>), id });
        json({ ...(body as Record<string, unknown>), id }, 202);
      });
      return true;
    }
    if (method === "DELETE") {
      journal.settingsWrites.push({ method, path, body: null });
      quality.customFormats.delete(id);
      json({});
      return true;
    }
  }

  return false;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
