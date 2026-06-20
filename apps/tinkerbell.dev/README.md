# tinkerbell.dev

The public marketing website for Tinkerbell — a multi-page Vite + React app
(matching the repo's house stack: React 19, Vite 6, plain CSS modules).

```sh
pnpm --filter @tinkerbell/tinkerbell.dev dev        # local dev server
pnpm --filter @tinkerbell/tinkerbell.dev build      # static build → dist/
pnpm --filter @tinkerbell/tinkerbell.dev typecheck
```

The output in `dist/` is a plain static bundle, deployable to any static host.

## Content

Marketing copy lives in one place: [`src/data/content.ts`](src/data/content.ts)
(`FEATURES`, `SHOTS`). Pages (`Home`, `Features`, `Screenshots`) render from it,
so editing copy or adding a feature is a single-file change.

## Screenshot harness

`public/screenshots/*.png` are **real captures of the admin UI** (`apps/web`),
produced by an automated browser harness — never hand-made mockups, and never
real Plex data or copyrighted artwork.

```sh
pnpm --filter @tinkerbell/tinkerbell.dev capture
```

The harness (`harness/`) does the following, fully isolated from your real
`tinkerbell.db`:

1. recreates a throwaway DB under `.harness-data/` (via `DATA_DIR`) and migrates it
2. starts an in-process **mock Plex** (`mock-plex.ts`) that serves synthetic
   gradient posters (`posters.ts`) plus minimal section/metadata/hub responses
3. **seeds** the DB (`seed.ts` + `data.ts`) with invented titles, collections,
   rules, and events — and points the Plex config at the mock origin
4. starts `apps/server` (`:3000`) and `apps/web` via Vite (`:5273`)
5. drives headless Chromium (Playwright) over the routes in `shots.ts`, writing
   one PNG per screen

To add or change a screenshot, edit `harness/shots.ts` (and a matching `SHOTS`
entry in `src/data/content.ts`) and re-run `capture`.

First run only, install the browser: `pnpm exec playwright install chromium`.
