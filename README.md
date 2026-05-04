# Tinkerbell

A self-hosted Plex companion for automating library curation. Define rules over your Plex media (using metadata from IMDb/OMDb and requests from Overseerr) to drive collections, overlays, and notifications on a schedule.

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Server** (`apps/server`): Node, tRPC, Drizzle + SQLite, Sidequest job runner
- **Web** (`apps/web`): React 19, Vite, TanStack Query, React Router
- **Shared:** `packages/db` (schema/migrations), `packages/overlays` (image composition via sharp), `clients/{plex,imdb,omdb,seerr}`

## Dev setup

Requires Node 25+ and pnpm 9.15.

```sh
pnpm install
pnpm db:migrate
pnpm dev
```

`pnpm dev` runs server (`:3000`) and web (Vite) via Turbo, with `portless` for local hostnames (`api.tinkerbell`, `web.tinkerbell`).

Database lives at `tinkerbell.db` (SQLite). Schema changes:

```sh
pnpm db:generate   # generate migration from schema
pnpm db:migrate    # apply migrations
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
