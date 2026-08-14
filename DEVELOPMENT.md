# Development

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Server** (`apps/server`): Node, tRPC, Drizzle + SQLite, Sidequest job runner;
  serves both the admin app and the user portal (separate ports)
- **Web** (`apps/web`): React 19, Vite, TanStack Query, React Router — admin UI
- **Portal** (`apps/portal`): React 19 + Vite — the self-service "Sign in with
  Plex" preferences app
- **Shared:** `packages/db` (schema/migrations), `packages/overlays` (image
  composition via sharp), `clients/{plex,imdb,omdb,seerr}`

## Setup

Requires Node 25+ and pnpm 9.15.

```sh
mise install   # node + localias
pnpm install
pnpm dev
```

`pnpm dev` runs `pnpm migrate` first as a discrete step, brings up the local
proxy, then starts the apps via Turbo. Migrations are applied at the entrypoint
(dev script / Docker entrypoint) — never as part of application boot.

### Local hostnames

Every app serves on a fixed port, and
[localias](https://github.com/peterldowns/localias) proxies a named HTTPS
hostname onto each:

| URL                                   | App                             | Port   |
| ------------------------------------- | ------------------------------- | ------ |
| `https://api.tinkerbell.localhost`    | server                          | `3000` |
| `https://web.tinkerbell.localhost`    | web (admin UI)                  | `5173` |
| `https://portal.tinkerbell.localhost` | portal                          | `5174` |
| `https://site.tinkerbell.localhost`   | tinkerbell.dev (marketing site) | `5175` |

The mapping lives in `.localias.yaml` at the repo root; edit it and re-run
`pnpm proxy:up` to apply. localias manages `/etc/hosts` and a local root
certificate, so the first run prompts for sudo.

`pnpm dev` starts the proxy for you and stops it again when the dev session
ends, Ctrl-C included. To drive it by hand: `pnpm proxy:up`, `pnpm proxy:down`,
`pnpm proxy:status`.

The proxy is optional — if localias isn't installed, `pnpm dev` warns and
carries on, and the apps remain reachable on their raw ports.

## Database

The dev database lives at `tinkerbell.db` (SQLite). Schema changes go through
the Drizzle CLI — never hand-edit the journal or the generated SQL:

```sh
pnpm db:generate   # generate a migration from the schema
pnpm db:migrate    # apply migrations (also runs as part of `pnpm dev`)
```

## Checks

```sh
pnpm test        # all workspaces with a test script
pnpm typecheck
pnpm lint        # oxlint + source guards
pnpm format      # oxfmt
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
  into a design document. Write the `\u0000` escape instead; it's byte-identical at
  runtime.

A `lint-staged` pre-commit hook runs via husky.

## Screenshots

`screenshots/` holds every page of the admin UI at two viewports, captured
against a mock Plex server and synthetic data.

```sh
pnpm screenshots        # in Docker, then `git add screenshots`
pnpm screenshots:local  # faster, for iterating — don't commit the result
```

See [screenshots/README.md](screenshots/README.md) for why the Docker run is
the canonical one.

## Release

```sh
pnpm release <patch|minor|major>
```

Requires a clean working tree. Tagging `v*` triggers
`.github/workflows/docker-publish.yml`, which publishes `linux/amd64` and
`linux/arm64` images to GHCR under `latest` and the semver tags; every push to
`master` publishes `edge`.
