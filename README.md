# Tinkerbell

A self-hosted Plex companion for automating library curation. Define rules over your Plex media (using metadata from IMDb/OMDb and requests from Overseerr) to drive collections, overlays, and notifications on a schedule.

## Features

- **Rules engine** — define rules that produce Plex collections from your library, refreshed on a schedule with full run history.
- **Smart filters** — compose criteria over Plex metadata, IMDb ratings, and Overseerr requests; AI-assisted filter generation via Anthropic.
- **Collections** — auto-managed Plex collections with sort order, pinning, and shuffle hubs for randomised home-screen rotations.
- **Overlays** — image composition (sharp) to stamp ratings, badges, and labels onto poster artwork.
- **Because you watched** — generate per-user recommendation collections.
- **Personalized home screens** — an opt-in, server-wide mode that lets each Plex user tune their own recommendations (loved/liked/hated genres and more). See below.
- **Prerolls** — upload the videos Plex plays before a movie; Tinkerbell transcodes anything Plex wouldn't direct play and manages the server's pre-roll setting. See below.
- **Labels** — bulk apply/undo Plex labels driven by rules, with previewable changes.
- **Notifications** — Discord, Slack, Telegram, Gotify, Pushbullet, Pushover, LunaSea, and generic webhooks.
- **Job runner** — Sidequest-backed background jobs with detail views, run logs, and a stress-test harness.
- **Stats & events** — library stats, activity feed, and changelog UI.
- **Multi-user** — per-user settings and integrations (Plex, \*Arrs, Overseerr).

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Server** (`apps/server`): Node, tRPC, Drizzle + SQLite, Sidequest job runner; serves both the admin app and the user portal (separate ports)
- **Web** (`apps/web`): React 19, Vite, TanStack Query, React Router — the admin UI
- **Portal** (`apps/portal`): React 19 + Vite — the self-service "Sign in with Plex" preferences app
- **Shared:** `packages/db` (schema/migrations), `packages/overlays` (image composition via sharp), `clients/{plex,imdb,omdb,seerr}`

## Dev setup

Requires Node 25+ and pnpm 9.15.

```sh
pnpm install
pnpm dev
```

`pnpm dev` runs `pnpm migrate` first as a discrete step, then starts the apps via Turbo. Migrations are applied at the entrypoint (dev script / Docker entrypoint) — never as part of application boot.

Server runs on `:3000`, web on Vite, with `portless` for local hostnames (`api.tinkerbell`, `web.tinkerbell`).

## Network exposure

Tinkerbell is unauthenticated: anyone who can reach the server port can call every tRPC mutation. To make this safe-by-default, the server binds to `127.0.0.1` by default. Override with the `HOST` environment variable:

- `HOST=127.0.0.1` (default) — loopback only, safe.
- `HOST=0.0.0.0` — listen on all interfaces. The Docker image sets this so the container is reachable from the host. Only do this when the port is behind a trusted reverse proxy or firewall.

The server logs a `[security]` warning at startup whenever it binds to a non-loopback interface.

The **user portal** (Sign in with Plex) runs as a separate app (`apps/portal`) on its own port so it can be exposed publicly without exposing the unauthenticated admin API:

- `USER_PORT` (default `3100`) — the portal's port.
- `USER_HOST` (default: same as `HOST`) — the portal's bind address. The Docker image inherits `HOST=0.0.0.0` and exposes `3100` alongside `3000`.

For a public deployment, expose only the portal port (`3100`) and keep the admin port (`3000`) on a trusted network / behind a reverse proxy.

The portal listener only runs while **Personalized Home Screens** is enabled (Settings → Personalization); enabling/disabling the feature starts/stops it automatically.

## Personalized home screens

Per-user recommendations (Because You Watched, and any rule marked _personalizable_) work by giving each user a `User:<name>`-labelled collection and restricting their Plex sharing so they only see their own. Because isolation only holds when **every** shared user is restricted, this is gated behind a single server-wide switch you control under **Settings → Personalization**.

- **Enable** stamps the `Tinkerbell` label on every item in your configured libraries (so restricted users keep full library access) and restricts each shared user to `[Tinkerbell, User:<self>]`. It snapshots each user's prior sharing settings first.
- **Disable** deletes every per-user collection _before_ lifting restrictions (so nothing briefly leaks to everyone), then restores each user's snapshotted sharing settings and removes the `Tinkerbell` labels — leaving the server as if it had never been enabled.
- Users set their own tastes (loved/liked/hated genres, moods, rating floor, excluded titles, …) in the **portal** by signing in with Plex; an admin can also set them under **Settings → User Preferences**. Preferences are inert until the user opts in.

Caveats: the Plex server **owner cannot be restricted**, so the owner sees every user's personalized collections. Newly shared users are not restricted automatically — use **Reconcile users** after adding someone.

Database lives at `tinkerbell.db` (SQLite). Schema changes:

```sh
pnpm db:generate   # generate migration from schema
pnpm db:migrate    # apply migrations (also runs automatically as part of `pnpm dev`)
```

## Prerolls

A preroll is a short video Plex plays before every movie. Plex stores them as a
list of paths **on its own filesystem** (the `CinemaTrailersPrerollID` server
preference), which means Tinkerbell and Plex have to share a directory.

Mount one directory into both containers:

```yaml
services:
  tinkerbell:
    volumes:
      - ./config:/config
      - ./prerolls:/prerolls
  plex:
    volumes:
      - ./prerolls:/prerolls # must be readable by Plex
```

Then set **Settings → Prerolls → "The same directory, as Plex sees it"** to
whatever path Plex mounts it at. If both containers use `/prerolls`, the
default is already correct.

Uploads are probed with `ffprobe` and left untouched when Plex would already
direct play them; anything else is normalised to H.264/AAC in an MP4 so a
ten-second clip can't occupy a transcode session. `ffmpeg` ships in the Docker
image; for a bare install, put it on `PATH` (`brew install ffmpeg`,
`apt install ffmpeg`).

Two things worth knowing:

- **Prerolls are a Plex Pass feature.** Without a subscription Plex stores the
  setting and plays nothing.
- **A wrong path mapping fails silently.** Plex accepts the setting and then
  finds no file. The Prerolls page reports whether Plex is in sync, and the
  health check watches for drift.

Set `PREROLLS_DIR` to move Tinkerbell's side of the directory; it defaults to
`$DATA_DIR/prerolls` outside Docker.

## Testing

```sh
pnpm test          # all workspaces with a test script
pnpm typecheck
pnpm lint          # oxlint
pnpm format        # oxfmt
```

Tests use Node's built-in test runner. Currently covered: `packages/overlays`,
`clients/plex`, `packages/core`, `packages/jobs`.

`pnpm lint` also runs two source guards:

- `scripts/check-fetch.mjs` fails on any `fetch()` without a timeout under
  `clients/`, `packages/`, `domains/` or `apps/server/`. A request with no
  deadline is the easiest way to wedge the job queue — the run never finishes,
  so nothing else runs either. Route new calls through `@tinkerbell/http`
  (which takes `timeoutMs`), or add an `AbortSignal.timeout()`.
- `scripts/check-nul.mjs` fails on a raw NUL byte in a source file. NUL is a
  fine delimiter, but written literally it makes `grep` and `file(1)` treat the
  whole file as binary and skip it _silently_ — which once put a wrong claim
  into a design document. Write `\u0000` instead; it's byte-identical at
  runtime.

## Background jobs

Scheduled work runs through a small queue on top of Sidequest. A few things
worth knowing when running this unattended:

- **Schedules are timezone-aware.** Set the zone in Settings → Schedules; it
  falls back to `TZ`, then the container's clock. Cron expressions are
  evaluated in that zone, so "3am" means 3am there across daylight-saving
  changes. If Tinkerbell was down when an infrequent job should have fired, it
  runs once on the next boot and says so in the log.
- **Every run has a deadline.** Each command has a generous wall-clock budget
  (6h for preroll processing, 4h for generate, 30min for most things) and a
  watchdog marks anything past it as failed, so one wedged job can't stop the
  queue forever.
- **Long jobs checkpoint.** `generate` and `sync-media` record their progress
  as they go and resume where they left off if the container restarts
  mid-run — the log says so when it happens. Checkpoints expire after 24 hours,
  and cancelling a run discards its checkpoint, so an explicit cancel followed
  by "Run now" starts over rather than resuming.
- **Missed schedules run once on the next boot.** If the machine is off
  overnight, an infrequent job whose time passed while it was down runs once
  when Tinkerbell starts, staggered a few seconds apart. On a server that is
  only powered on in the evenings this means several jobs catching up at each
  boot — expected, and every decision is logged. Jobs scheduled more often than
  hourly are never caught up.
- **Run one instance.** Cron schedules and the "already running" guard both
  assume a single process. Pointing two replicas at one database will
  double-fire every schedule and let two runs of the same job overlap.

### Logging

`LOG_LEVEL` (`debug` | `info` | `warn` | `error`, default `info`) controls
verbosity, including the Sidequest engine's own output — raise it to `debug`
when a job misbehaves. Set `LOG_FORMAT=json` for one JSON object per line if
you ship container logs to a collector.

## Production

```sh
docker build -t tinkerbell .
docker run -v /path/to/config:/config -v /path/to/prerolls:/prerolls -p 3000:3000 tinkerbell
```

The container serves the built web app and tRPC API from a single Node process. Persistent state (SQLite, config) lives in `/config`. The `/prerolls` volume is only needed if you use the Prerolls feature, and must also be mounted into Plex — see above.
