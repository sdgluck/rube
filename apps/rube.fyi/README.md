# rube.fyi

The public marketing website for Rube — a multi-page Vite + React app
(matching the repo's house stack: React 19, Vite 6, plain CSS modules).

```sh
pnpm --filter @rube/rube.fyi dev        # local dev server
pnpm --filter @rube/rube.fyi build      # static build → dist/
pnpm --filter @rube/rube.fyi typecheck
```

The output in `dist/` is a plain static bundle, deployable to any static host.

## Content

Marketing copy lives in one place: [`src/data/content.ts`](src/data/content.ts)
(`FEATURES`, `SHOTS`). Pages (`Home`, `Features`, `Screenshots`) render from it,
so editing copy or adding a feature is a single-file change. Keep it plain:
what the feature does, with real nouns and numbers, and no slogans.

The look is the admin app's own: its light tokens in `src/styles/theme.css`, and
Archivo and IBM Plex Mono copied into `public/fonts`.

## Screenshot harness

`public/screenshots/*.png` are **real captures of the admin UI** (`apps/web`),
produced by an automated browser harness — never hand-made mockups, and never
real Plex data or copyrighted artwork.

```sh
pnpm --filter @rube/rube.fyi capture
```

The harness (`harness/`) does the following, fully isolated from your real
`rube.db`:

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

The same run writes the home page's poster strip to `public/posters/`, from the
list in `src/data/posters.ts`, using the harness's own poster generator.

First run only, install the browser: `pnpm exec playwright install chromium`.
