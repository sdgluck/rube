# Tinkerbell

A self-hosted Plex companion for automating library curation. Define rules over your Plex media (using metadata from IMDb/OMDb and requests from Overseerr) to drive collections, overlays, and notifications on a schedule.

## Features

- **Rules engine** — define rules that produce Plex collections from your library, refreshed on a schedule with full run history.
- **Smart filters** — compose criteria over Plex metadata, IMDb ratings, and Overseerr requests; AI-assisted filter generation via Anthropic.
- **Collections** — auto-managed Plex collections with sort order, pinning, and shuffle hubs for randomised home-screen rotations.
- **Overlays** — image composition (sharp) to stamp ratings, badges, and labels onto poster artwork.
- **Because you watched** — generate per-user recommendation collections.
- **Labels** — bulk apply/undo Plex labels driven by rules, with previewable changes.
- **Notifications** — Discord, Slack, Telegram, Gotify, Pushbullet, Pushover, LunaSea, and generic webhooks.
- **Job runner** — Sidequest-backed background jobs with detail views, run logs, and a stress-test harness.
- **Stats & events** — library stats, activity feed, and changelog UI.
- **Multi-user** — per-user settings and integrations (Plex, \*Arrs, Overseerr).

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Server** (`apps/server`): Node, tRPC, Drizzle + SQLite, Sidequest job runner
- **Web** (`apps/web`): React 19, Vite, TanStack Query, React Router
- **Shared:** `packages/db` (schema/migrations), `packages/overlays` (image composition via sharp), `clients/{plex,imdb,omdb,seerr}`

## Dev setup

Requires Node 25+ and pnpm 9.15.

```sh
pnpm install
pnpm dev
```

`pnpm dev` runs `pnpm migrate` first as a discrete step, then starts the apps via Turbo. Migrations are applied at the entrypoint (dev script / Docker entrypoint) — never as part of application boot.

Server runs on `:3000`, web on Vite, with `portless` for local hostnames (`api.tinkerbell`, `web.tinkerbell`).

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
