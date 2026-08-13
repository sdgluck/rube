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
mise install   # node + localias
pnpm install
pnpm dev
```

`pnpm dev` runs `pnpm migrate` first as a discrete step, brings up the local proxy, then starts the apps via Turbo. Migrations are applied at the entrypoint (dev script / Docker entrypoint) — never as part of application boot.

### Local hostnames

Every app serves on a fixed port, and [localias](https://github.com/peterldowns/localias) proxies a named HTTPS hostname onto each:

| URL                                   | App                             | Port   |
| ------------------------------------- | ------------------------------- | ------ |
| `https://api.tinkerbell.localhost`    | server                          | `3000` |
| `https://web.tinkerbell.localhost`    | web (admin UI)                  | `5173` |
| `https://portal.tinkerbell.localhost` | portal                          | `5174` |
| `https://site.tinkerbell.localhost`   | tinkerbell.dev (marketing site) | `5175` |

The mapping lives in `.localias.yaml` at the repo root; edit it and re-run `pnpm proxy:up` to apply. localias manages `/etc/hosts` and a local root certificate, so the first run prompts for sudo.

`pnpm dev` starts the proxy for you and stops it again when the dev session ends, Ctrl-C included. To drive it by hand: `pnpm proxy:up`, `pnpm proxy:down`, `pnpm proxy:status`.

The proxy is optional — if localias isn't installed, `pnpm dev` warns and carries on, and the apps remain reachable on their raw ports.

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

Images are published to GHCR for `linux/amd64` and `linux/arm64` by
`.github/workflows/docker-publish.yml`: `latest` and the semver tags on each
`v*` tag, `edge` on every push to `master`.

```sh
docker run -d --name tinkerbell \
  -v /path/to/config:/config \
  -v /path/to/prerolls:/prerolls \
  -p 3000:3000 -p 3100:3100 \
  -e PUID=99 -e PGID=100 -e TZ=Europe/London \
  ghcr.io/sdgluck/tinkerbell:latest
```

Or build it yourself with `docker build -t tinkerbell .`.

The container serves the built web app and tRPC API from a single Node process. Persistent state (SQLite, config) lives in `/config`. The `/prerolls` volume is only needed if you use the Prerolls feature, and must also be mounted into Plex — see above.

Files in `/config` and `/prerolls` are chowned to `PUID:PGID` (default `99:100`,
Unraid's `nobody:users`) by the entrypoint, which then drops from root before
running migrations and the server.

## Unraid

`unraid/tinkerbell.xml` is a Community Applications template. Until it is
listed in the CA appfeed, install it by hand:

1. Copy the template onto the array at
   `/boot/config/plugins/dockerMan/templates-user/my-Tinkerbell.xml`:

   ```sh
   wget -O /boot/config/plugins/dockerMan/templates-user/my-Tinkerbell.xml \
     https://raw.githubusercontent.com/sdgluck/tinkerbell/master/unraid/tinkerbell.xml
   ```

2. **Docker → Add Container**, and pick `Tinkerbell` from the _Template_
   dropdown (under "User templates").
3. Check the paths and hit **Apply**. Unraid pulls the image and starts it.

The template's defaults:

| Setting            | Default                        | Notes                                                                                  |
| ------------------ | ------------------------------ | -------------------------------------------------------------------------------------- |
| WebUI port (admin) | `3000`                         | Unauthenticated — LAN only. See [Network exposure](#network-exposure).                 |
| User Portal port   | `3100`                         | Sign in with Plex; safe to expose. Only listens while Personalized Home Screens is on. |
| `/config`          | `/mnt/user/appdata/tinkerbell` | SQLite database and settings. Back this up.                                            |
| `/prerolls`        | `/mnt/user/prerolls`           | Optional. Map the **same host path** into the Plex container.                          |
| `PUID` / `PGID`    | `99` / `100`                   | Unraid's `nobody:users`.                                                               |
| `TZ`               | `Europe/London`                | The zone cron schedules are evaluated in; Settings → Schedules overrides it.           |

Two Unraid-specific things worth repeating:

- **Do not forward port 3000.** The admin UI has no login: anyone who reaches
  it can call every mutation. If you want remote access, put it behind an
  authenticating reverse proxy, or expose only the portal on `3100`.
- **Prerolls need the same path in both containers.** Add
  `/mnt/user/prerolls` to your Plex container too (read-only is fine), then
  set Settings → Prerolls → "The same directory, as Plex sees it" to the path
  _Plex_ mounts it at. A wrong mapping fails silently — Plex accepts the
  setting and plays nothing.
