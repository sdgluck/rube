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
pnpm verify         # everything below except format, in one go (~50s)
pnpm test           # the whole suite, one node --test process (~45s)
pnpm test:coverage  # the same, with Node's coverage reporter
pnpm typecheck
pnpm lint           # oxlint + source guards
pnpm format         # oxfmt
```

`pnpm verify` is the one to run before pushing. It does format, lint and
typecheck first and only starts the suite if they pass, so a stray formatting
slip comes back in about seven seconds instead of a minute.

`pnpm test` takes bare arguments as path filters (`pnpm test domains/rules`)
and forwards `-`-prefixed ones to `node --test`
(`pnpm test --test-name-pattern="retention"`).

All four run in CI on every pull request and before every image is published
(`.github/workflows/ci.yml`, called by `docker-publish.yml`). Nothing used to,
which is how a lint failure sat on `master` for three commits.

### Writing tests

Node's built-in runner throughout — `node --test --experimental-strip-types`,
`node:test` plus `node:assert/strict`, files named `*.test.ts` beside the code
they cover. There is no vitest, no jest, and no DOM: `apps/web`'s glob is
deliberately `*.test.ts` rather than `*.test.tsx`, so client-side tests cover
extractable logic and leave rendering to the screenshot harness.

Three pieces of scaffolding do most of the work:

- **`createTestDb()`** (`@tinkerbell/db/test-db`) — a throwaway, fully migrated
  database in a temp directory. On disk rather than `:memory:`, because WAL and
  the mmap pragmas are no-ops in memory and a test that passes against a
  different storage mode than production is worth less than the milliseconds it
  saves.
- **`createTestContainer({ overrides, now })`**
  (`@tinkerbell/composition/test-support`) — the **real** DI graph on that
  database. `overrides` uses `registry.replace`, so a test exercises the wiring
  that ships with named edges swapped rather than a parallel graph assembled by
  hand. Passing `now` replaces `ClockToken` with a fixed clock and gives the
  container `setNow`/`advance`, which is how a retention or grace-period test
  moves time instead of writing rows into the past.
- **`@tinkerbell/test-support`** — stateful Plex and \*Arr servers speaking real
  HTTP on port 0, each with a `journal` of what it was asked to do, plus
  `failNext` for asserting that a mutation is _not_ retried. Point the code at
  one by writing its origin into config: `setConfig("global_plex_url",
plex.origin)`.

Prefer a mock server to a `fetch` stub. A stub agrees with you about URL
construction, parameter encoding, which endpoint a mutation was addressed to
and how the response was parsed — two real bugs in this repo lived in exactly
those places. `packages/jobs/src/commands/generate/cleanup.integration.test.ts`
is the worked example.

Two constraints to know about: every `fetch` you write in a test under
`clients/`, `packages/`, `domains/` or `apps/server/` needs an
`AbortSignal.timeout(...)` or `check-fetch.mjs` fails the lint; and
`assertSafeOutboundUrl` is a no-op unless `NODE_ENV=production`, so a test of it
has to set that itself.

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

The phone screenshots are the same pages at a 430px touch viewport — the
admin app's responsive layout, with the sidebar as a drawer. One switch helps
when iterating locally (never commit its output):

```sh
TB_CAPTURE_ONLY=settings,rules pnpm --filter @tinkerbell/tinkerbell.dev capture   # just these shots
```

The portal still has per-platform phone styles: append `?platform=ios` or
`?platform=android` to a portal URL to preview one in a desktop browser's
device mode.

## Native apps

One app per platform, both `dev.tinkerbell.app` with the `tinkerbell://` link
scheme: SwiftUI in `native/ios` and Jetpack Compose in `native/android`. They
call the same `/api/trpc` endpoints the SPAs do, as plain JSON (queries are
GET with `?input=`, mutations POST), and hold two independent connections, one
to the portal and one to the admin server.

```sh
pnpm native:dev-server   # seeded server, mock Plex and mock plex.tv on 0.0.0.0; prints connect links
pnpm native:codegen      # regenerate the Swift and Kotlin models
```

iOS (Xcode 26, iOS 26):

```sh
open native/ios/Tinkerbell.xcodeproj
swift test --package-path native/ios/Packages/TinkerbellKit
# UI tests, against a running native:dev-server:
xcodebuild test -project native/ios/Tinkerbell.xcodeproj -scheme Tinkerbell \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

Android (JDK 21, Android SDK 35, `ANDROID_HOME` set):

```sh
cd native/android
./gradlew test lint assembleDebug
# UI tests, on a running emulator, against a running native:dev-server:
./gradlew :app:connectedDebugAndroidTest
```

- **The models are generated.** Every procedure the apps call is listed in
  `NATIVE_PROCEDURES` (`packages/contracts/src/native-api`), and its router
  attaches that schema with `.output()`. The server validates what it sends,
  and tRPC types the resolver against it. `packages/native-codegen` turns the
  schemas, and each procedure's own `.input()`, into `Generated/API.swift` and
  `generated/Api.kt`. To change a shape, change the schema, run
  `pnpm native:codegen` and commit both. `pnpm verify` and CI fail while the
  generated files are stale. Outputs must be plain JSON: no `z.date()`,
  bigints or transforms, and timestamps are epoch milliseconds. Mark integers
  with `int()`.
- **The generators are separate packages.** They are
  [zod-native-ir](https://github.com/sdgluck/zod-native-ir),
  [zod-to-swift](https://github.com/sdgluck/zod-to-swift) and
  [zod-to-kotlin](https://github.com/sdgluck/zod-to-kotlin), taken as GitHub
  dependencies pinned to a tag. Each repo commits its `dist/`, because pnpm 11
  won't run a git dependency's build. To change one, release a new tag there,
  then bump the pin in `packages/native-codegen/package.json`.
- **Sign-in.** The app runs the plex.tv PIN flow itself, then calls
  `auth.exchange({ plexToken })` on each server. Each server checks the account
  on its own and returns a session in the response body. `exchange` refuses
  any request carrying `Origin` or `Sec-Fetch-Site`, so a web page can't read
  a session that way.
- **The dev server.** `native:dev-server` signs in against a mock plex.tv.
  Connect links carry `plexTv=`, which only a debug build honours. The iOS
  simulator reaches the host as `127.0.0.1` and the Android emulator as
  `10.0.2.2`. Debug builds also take launch switches that the UI tests use:
  - **iOS:** `-TBResetState YES`, `-TBDevSignInAs <plexUserId>` and
    `-TBOpenURL <link>`.
  - **Android:** the intent extras `tb.resetState`, `tb.devSignInAs` and
    `tb.openUrl`.
- **Emulator.** Start the Android emulator with `-gpu host`. With the default
  software renderer, a debug build is too slow for the UI tests' timeouts.
- **Versions.** `pnpm release` stamps `native/ios/Config/Version.xcconfig` and
  `native/android/version.properties`. The build number is the version as one
  integer: 0.43.0 → 43000.
- **CI.** `.github/workflows/native.yml` runs only when `native/` changes. It
  runs the package tests and a simulator build on macOS, and
  `test lint assembleDebug` on Linux. The UI tests run locally only. Signing
  and store upload are manual, and the keys stay outside the repo.

### The old Capacitor apps

The SPAs no longer build into Capacitor apps. Copies already installed carry
their own bundle, so for one more release the server still supports them in
three ways:

- the `auth.start({ client: "native" })` handshake;
- CORS for their fixed origins (`apps/server/src/cors.ts`);
- `?access_token=` media tokens.

All three go in the following release.

## Release

```sh
pnpm release <patch|minor|major>
```

Requires a clean working tree. Tagging `v*` triggers
`.github/workflows/docker-publish.yml`, which publishes `linux/amd64` and
`linux/arm64` images to GHCR under `latest` and the semver tags; every push to
`master` publishes `edge`.
