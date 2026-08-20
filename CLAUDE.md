# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Tinkerbell is a self-hosted Plex companion: rules over your Plex library (plus
IMDb/OMDb/TMDb metadata and Overseerr requests) drive collections, overlays,
labels, playlists, cleanup and notifications on a schedule. One Node process
serves the admin SPA, the tRPC API and the end-user portal.

`README.md` documents user-facing behaviour (auth, personalization, prerolls,
backups, unattended operation) and `DEVELOPMENT.md` the stack and setup — read
those for _what the product does_. This file is _how the code is put together_.

## Commands

```sh
pnpm dev            # migrate → localias proxy → all apps via turbo
pnpm test           # every workspace with a test script
pnpm typecheck      # 4 tsc programs; `pnpm typecheck web` for one
pnpm lint           # oxlint + stylelint + check-fetch + check-nul
pnpm format         # oxfmt (skips packages/db/drizzle)
pnpm build          # turbo run build
pnpm db:generate    # drizzle-kit: generate a migration from schema.ts
pnpm db:migrate     # apply migrations
pnpm screenshots    # canonical (Docker) capture of screenshots/
pnpm release <patch|minor|major>
```

One package's tests: `pnpm --filter @tinkerbell/domain.rules test`.
One test file: `node --test --experimental-strip-types path/to/x.test.ts`.
One test by name: add `--test-name-pattern="..."`.

`pnpm` on `PATH` may be v8 in non-interactive shells and will downgrade the
lockfile — use mise's pnpm 11 binary for installs.

Dev URLs come from localias (`.localias.yaml`): `api.` `web.` `portal.`
`site.tinkerbell.localhost`. Raw ports 3000/5173/5174/5175 work without it.

## Workspace layout

pnpm workspaces + Turborepo. Four globs, and the order matters:

- `packages/*` — infrastructure and shared logic (wave 0–1).
- `clients/*` — one per upstream HTTP API: `plex`, `imdb`, `omdb`, `tmdb`,
  `seerr`, `radarr`, `sonarr`, `arr`, `servarr-http`.
- `domains/*` — ~33 business capabilities, one package each
  (`rules`, `collections`, `media`, `users`, `cleanup`, `overlays`, …).
- `apps/*` — `server`, `web` (admin SPA), `portal` (end-user SPA),
  `tinkerbell.dev` (marketing site + rule registry + screenshot harness).

**Packages resolve each other as raw TypeScript source** —
`"main": "./src/index.ts"`, no build step, `--experimental-strip-types` at
runtime. There is no `dist/` to stale out.

Layering is enforced by oxlint `no-restricted-imports`: apps never import each
other; `packages/**` and `domains/**` never import an app. Web consumes the
server only through `@tinkerbell/contracts` (values) and `@tinkerbell/trpc`
(**types only**).

## The composition root — read this before adding anything

Everything is wired in one place: `packages/composition`. There is no module
singleton, no import-time database connection, and no mutable setter.

```
buildContainer(env, modules) →
  registerCore(r, env)     packages/composition/src/core.module.ts
  registerDomains(r)       packages/composition/src/domains.module.ts
  registerServices(r)      packages/composition/src/services.ts
  ...modules               e.g. registerJobs from @tinkerbell/jobs
```

`packages/container` is the kernel (~200 lines, zero deps): `token<T>(name)`,
three lifetimes (`singleton` / `scoped` / `transient`), LIFO disposal, cycle
detection, and a registry that is **sealed** after `configure` — late
registration is impossible by design.

Key rules:

- **A token is registered exactly once.** `register` throws on a duplicate;
  `replace` exists for tests only.
- **`scoped` cannot resolve from the root** (`ScopeRequiredError`) — that is
  the captive-dependency guard. Singletons are always built against the root.
- **Inverted edges live in `packages/ports`**: `HealthReporterToken`,
  `EventBusToken`, `NotifierToken`, `CollectionsReaderToken`,
  `PostCollectionSyncToken`, `ChangeRecorderToken`, `JobConfigWriterToken`,
  `ClockToken`. These are the edges where a lower layer must reach a higher
  one; the composition root registers each as a closure that resolves its
  provider _when called_, which is how the two genuine cycles
  (events↔notifications, collections↔migration) work. Ports has **no runtime
  imports** beyond the container — a token with a natural owner lives beside
  its owner (`DbToken` in `@tinkerbell/db`, `ConfigStoreToken` in
  `@tinkerbell/core`), not here.
- `packages/composition/src/container.test.ts` **resolves every registered
  token**. A missing wiring edge is a failing test, not a silent no-op. This
  test is the reason the whole DI layer exists — do not weaken it.
- `perDeps(factory)` (`@tinkerbell/container`) memoises a sub-factory on its
  deps object by identity, so a helper called from two places inside a package
  still yields one instance.

`ServicesToken` resolves **every domain as one object** (`services.rules`,
`services.config`, `services.clients`, …). This is the deliberate single place
where breadth is allowed: domains declare narrow `Deps`, but jobs and tRPC
routers legitimately touch a dozen domains each.

## Domain package shape

Every `domains/*` package is the same four exports in `src/index.ts`:

```ts
export interface SectionsDeps {
  db: Db;
}
export function createSections(deps: SectionsDeps) {
  /* … */ return {
    /* … */
  };
}
export type Sections = ReturnType<typeof createSections>;
export const SectionsToken = token<Sections>("sections");
```

Closures over `deps`, not classes. To add a domain: create the package, add it
to `domains.module.ts` (alphabetical; registration order is irrelevant since
nothing constructs during registration), add it to `services.ts`, and add its
name to the coverage assertion in `container.test.ts`.

## Server & tRPC

`apps/server/src/server.ts` is the only production entrypoint. It calls
`buildContainer({}, [registerJobs])`, resolves `ServicesToken` and `JobsToken`,
builds the routers, and runs **two HTTP servers**:

- admin on `PORT`/`HOST` (default `127.0.0.1:3000`) — `appRouter` + web SPA
  plus `/api/plex-image`, `/api/prerolls/*` and portability routes.
- portal on `USER_PORT`/`USER_HOST` (default `:3100`) — `portalRouter` + portal
  SPA only. The admin router is deliberately **not** mounted here. Started and
  stopped by a 15s reconcile loop against `portalShouldRun()`.

`packages/trpc` holds `*.router.ts`, one per feature area, each a
`createXRouter(deps: TrpcDeps)` factory (`TrpcDeps = Services & { jobs }`).

`_base.ts` is the important file:

- **`procedure` is the authenticated one** and is what every router imports.
  Staying public takes an explicit `publicProcedure`. `router-surface.test.ts`
  enumerates the whole surface and fails unless the path is in `PUBLIC_PATHS` —
  adding a public procedure is a reviewable act.
- Middleware chain: `logDuration` → `mapNotConfigured` (turns
  `NotConfiguredError` into 412) → `attributeToCaller` → `requireAdmin`.
- `attributeToCaller` sets an **ambient actor** (`packages/core/src/actor.ts`)
  so `setConfig` / `updateRule` / `updateJob` three layers down record who did
  it without an actor argument threaded through every call site.
- Bind Plex clients through `mapNotConfiguredClient(deps.clients)`.

`portal-isolation.test.ts` / `portal-surface.test.ts` guard the portal boundary.

## Jobs

`packages/jobs` sits **above** composition (its commands resolve
`ServicesToken`), so it registers itself via `registerJobs(r)` passed into
`buildContainer`. Sidequest is the runner; the worker thread builds its own
container from the same `buildContainer`.

- `src/commands/catalog.ts` — the single `COMMANDS` registry. Each entry is
  `{ load: () => import("./x.ts"), lane, timeoutMs }`. `lane` is `interactive`
  (a human is watching) or `default` (batch); the lanes have independent
  concurrency. `timeoutMs` is a runaway detector, not an SLA. **Adding a
  command is one edit here** — `DEFAULT_JOBS`, `FEATURE_TEMPLATES` and the
  Sidequest resolution all derive from it.
- `runner.ts` (start/watchdog/cancel), `queries.ts`, `schedule.ts` (croner, in
  the configured timezone), `checkpoint.ts` (resumable long jobs, 24h TTL),
  `deferral.ts`, `rule-queue.ts`, `internal-jobs.ts`.
- `sidequest/registry.ts` is Sidequest's `manualJobResolution` entrypoint and
  must keep its one-line shape — distinct from `commands/catalog.ts`.

Assume **one process**: cron schedules and the "already running" guard both
assume a single instance.

## The rules engine

`packages/jobs/src/commands/generate/` is the heart of the product. A rule is
**(selection) → (action)**; `generate`, `cleanup` and `metadata` are separate
jobs sharing one engine.

- `index.ts` — batch orchestration, per-rule locks, checkpoint/resume,
  concurrency, `runSingleRule` / `testRule`.
- `dispatch.ts` — a `switch` on `rule.type` picking a handler.
- `handlers/` — one per family of rule types (`smart-filter`, `rated`,
  `tmdb-grouped`, `imdb-content`, `seerr-requests`, `list-source`,
  `ai-prompt`, `static-list`, `year-grouped`, `media-grouped`, …).
- `sources/` — external list providers (`imdb`, `tmdb`, `mdblist`, `trakt`).
- `finalize.ts` (commit to Plex), `reconcile.ts` (pins, removal of unproduced),
  `rotation.ts`, `playlist.ts`, `plex-index.ts`, `item-cache.ts`.

**Rule types are declared in `packages/contracts/src/rule-config.ts`**
(`RULE_TYPE_VALUES`, `GROUPED_RULE_TYPES`, `EXTERNAL_GROUP_RULE_TYPES`,
`RULE_TYPE_REQUIRES`). Adding a rule type means: the value there, a `case` in
`dispatch.ts`, a handler, and the web wizard.

`packages/contracts` is the shared vocabulary between server and browser — zod
schemas for rule config, schedules, smart filters, presentation, and the public
rule registry. Put anything both sides need here; it is the only non-type
dependency web is allowed on the backend.

## Database

SQLite via better-sqlite3 + Drizzle, WAL mode. `packages/db/src/schema.ts` is
one ~2000-line file with ~55 tables, heavily commented; read the comment on a
column before changing it.

**Migrations go through the Drizzle CLI only** — `pnpm db:generate` then
`pnpm db:migrate`. Never hand-edit `packages/db/drizzle/**` (journal or SQL);
it is excluded from `pnpm format` for exactly this reason. Migrations are
applied at the **entrypoint** (dev script / Docker entrypoint), never at import
time or during app boot.

## Config, secrets and change history

`packages/core/src/config.ts` is a SQLite key/value store with a single typed
zod schema (`configSchema`, ~1200 lines). **Every setting is a key here.**

- `getConfig(key)` / `setConfig(key, value)` are fully typed off `ConfigKey`.
- Validate on **write** (usually `configRouter.save`), not in the schema —
  `configSchema` is used on read too, so a `.refine()` turns one bad row into a
  throw out of every config read.
- Secrets: add the key to `SECRET_KEYS`, or to `NESTED_SECRETS` if it lives
  inside a structured value. `REDACTED_SECRET` is the sentinel the UI renders;
  test-connection endpoints must `unredact()` it. Change history stores
  redacted values.
- `setConfig` records to the change log via `ChangeRecorderToken`
  (`domains/config-history`). Entities that get history: `rule`, `config`,
  `job`, `overlay_preset`, `preroll`. 180-day retention.

## Frontend

`apps/web` — React 19, Vite, TanStack Query via `@trpc/react-query`, React
Router 7. Subpath imports: `#pages/*`, `#components/*`, `#hooks/*`, `#lib/*`,
`#layout/*` (declared in `package.json` `imports`).

- Routes are lazy-loaded in `App.tsx`; the sidebar / bottom-nav lives in
  `src/nav.ts` (`NAV_SECTIONS`, with optional `metric` badges served by
  `nav.router.ts`); Settings sub-pages are listed in `#pages/Settings/sections`.
- `src/trpc.ts` — a `splitLink` (only `stats.sessions` is unbatched) and a
  fetch wrapper that broadcasts `UNAUTHORIZED_EVENT` on 401, handled once in
  `AuthGate`.

`apps/portal` — the separate "Sign in with Plex" preferences SPA. Its own
tokens (`src/tokens.css`), no import path to the app's design system.

### CSS design system (enforced by stylelint)

Three layers, and `stylelint.config.mjs` exists to stop a stylesheet skipping
one:

1. **Tokens** — `apps/web/src/App.css` (every colour, radius, face; both
   themes). The portal's are `apps/portal/src/tokens.css`.
2. **Primitives** — `src/styles/controls.module.css` (buttons, inputs) and
   `shared.module.css` (tables, panels, chips, toolbars), reached with
   `composes:`.
3. **Page modules** — only what is genuinely local to one screen.

So: no hex or named colours, no `rgb()`/`hsl()`, no literal `border-radius` /
`font-family` / `*color` — use a token. An unknown `var(--x)` fails. Class names
that shadow a primitive fail. Breakpoints must be on the shared scale. Escape
hatches need a reason comment (`reportDescriptionlessDisables`);
`pnpm lint:css:report` finds stale ones. `apps/tinkerbell.dev` is exempt — it is
a separate product with its own palette.

## HTTP clients

`clients/*` wrap upstream APIs; `@tinkerbell/http` (`httpRequest`,
`httpRequestJson`) takes `timeoutMs` and is the preferred route.
`assertSafeOutboundUrl` (the SSRF guard) is a **no-op unless
`NODE_ENV=production`** — a test of it has to set that itself.

Clients report to `HealthReporterToken`, which is why `createClients` takes it.

## Testing

Node's built-in runner only — `node --test --experimental-strip-types`,
`node:test` + `node:assert/strict`, `*.test.ts` beside the code. No vitest, no
jest, no DOM. `apps/web`'s glob is `*.test.ts` (not `.tsx`) on purpose:
client-side tests cover extractable logic, rendering is covered by the
screenshot harness.

Three pieces of scaffolding:

- `createTestDb()` — `@tinkerbell/db/test-db`. A throwaway migrated DB in a temp
  dir, on disk (WAL and the mmap pragmas are no-ops in `:memory:`).
- `createTestContainer({ overrides, now })` —
  `@tinkerbell/composition/test-support`. The **real** graph with named edges
  swapped via `registry.replace`. Passing `now` pins `ClockToken` and gives you
  `setNow` / `advance` — that is how you test retention, grace periods, quiet
  hours and schedule catch-up. Always `after(() => c.dispose())`.
- `@tinkerbell/test-support` — stateful mock Plex and \*Arr servers on real HTTP
  (port 0), each with a `journal` and `failNext`. Point code at one with
  `setConfig("global_plex_url", plex.origin)`.

**Prefer a mock server to a `fetch` stub** — a stub agrees with you about URL
construction, encoding, which endpoint a mutation was addressed to and how the
response was parsed, and two real bugs here lived in exactly those places.
Worked example:
`packages/jobs/src/commands/generate/cleanup.integration.test.ts`.

Turbo caches `test` on `["$TURBO_DEFAULT$", "src/**", "drizzle/**", "!dist/**"]`
with `NODE_ENV` in the cache key — a test that reads a new kind of file from
disk may need `inputs` updating in `turbo.json`.

## Non-negotiable lint guards

- `scripts/check-fetch.mjs` — every `fetch()` under `clients/`, `packages/`,
  `domains/`, `apps/server/` needs an `AbortSignal.timeout(...)` or must go
  through `@tinkerbell/http`. A deadline-less request wedges the job queue.
- `scripts/check-nul.mjs` — no raw NUL byte in a source file; write the
  `\u0000` escape instead. A literal NUL makes `grep` and `file(1)` treat the
  whole file as binary and skip it silently.
- oxlint `no-restricted-imports` — the app/package layering above.
- Pre-commit runs `lint-staged`: oxlint + oxfmt + `pnpm typecheck` for
  `.ts`/`.tsx`, stylelint-then-oxfmt for `.css`.

## Conventions

- **Comments explain the decision, not the mechanism.** This codebase's
  distinguishing habit is a header comment on every non-trivial file saying
  which bug or constraint the shape exists for. Match it: when you make a
  non-obvious choice, say why, and name the failure it prevents.
- Commits: conventional-ish, lowercase, with a scope and a sentence describing
  the effect — `fix(arr): relink the *Arr mirror to Plex after a media sync`.
  Commit and push directly to `master`; no topic branch, no PR.
- Releases: `pnpm release <patch|minor|major>` (or the `release` skill) — bumps
  every workspace version in step, writes CHANGELOG, regenerates screenshots,
  tags. Tagging `v*` publishes GHCR images.
- `screenshots/` is committed and generated by the Docker capture; regenerate
  with `pnpm screenshots` and never commit `screenshots:local` output — the font
  rasteriser differs per OS, so every glyph would change.

## Before planning a feature, know these

Most features touch a predictable spine. Work out which parts apply, and ask
about the ones the request leaves open:

1. **A setting?** → a key in `configSchema` (plus `SECRET_KEYS` if secret), a
   page under `#pages/Settings/`, an entry in `#pages/Settings/sections`, and
   validation in `configRouter.save`.
2. **Persistent state?** → a table in `packages/db/src/schema.ts`, then
   `pnpm db:generate`.
3. **Business logic?** → a new or existing `domains/*` package, wired into
   `domains.module.ts` and `services.ts`.
4. **An API?** → a `*.router.ts` in `packages/trpc` using `procedure`, mounted
   in `packages/trpc/src/index.ts`.
5. **Background work?** → a command file plus a `COMMANDS` entry with a lane
   and a timeout; decide whether it checkpoints and whether it is deferrable.
6. **UI?** → a lazy route in `App.tsx`, a `NAV_SECTIONS` entry (with a metric
   if it deserves a badge), a CSS module that `composes:` from the primitives.
7. **A cross-layer callback?** → a port in `packages/ports` plus a late-bound
   registration in `domains.module.ts`. Never a module-level mutable slot.
8. **A new rule type?** → `RULE_TYPE_VALUES` in contracts, a `dispatch.ts`
   case, a handler, and the wizard.
9. **Reaching an upstream API?** → a `clients/*` package with timeouts and
   health reporting, plus a mock server in `@tinkerbell/test-support` if
   anything integration-tests against it.
10. **Anything the user configures and can therefore misconfigure** → it
    belongs in the change log, and probably in the portable export
    (`domains/portability`).
