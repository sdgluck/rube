# Tinkerbell

A self-hosted Plex companion for automating library curation. Define rules over your Plex media (using metadata from IMDb/OMDb and requests from Overseerr) to drive collections, overlays, and notifications on a schedule.

## Features

- **Rules engine** — define rules that produce Plex collections from your library, refreshed on a schedule with full run history.
- **Smart filters** — compose criteria over Plex metadata, IMDb ratings, and Overseerr requests; AI-assisted filter generation via Anthropic.
- **Collections** — auto-managed Plex collections with sort order, pinning, and shuffle hubs for randomised home-screen rotations.
- **Overlays** — image composition (sharp) to stamp ratings, badges, and labels onto poster artwork.
- **Because you watched** — generate per-user recommendation collections.
- **Personalized home screens** — an opt-in, server-wide mode that lets each Plex user tune their own recommendations (loved/liked/hated genres and more). See below.
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

## Testing

```sh
pnpm test          # all workspaces with a test script
pnpm typecheck
pnpm lint          # oxlint
pnpm format        # oxfmt
```

Tests use Node's built-in test runner. Currently covered: `packages/overlays`, `clients/plex`.

## Production

```sh
docker build -t tinkerbell .
docker run -v /path/to/config:/config -p 3000:3000 tinkerbell
```

The container serves the built web app and tRPC API from a single Node process. Persistent state (SQLite, config) lives in `/config`.
