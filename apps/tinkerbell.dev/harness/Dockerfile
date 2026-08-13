# Screenshot capture, pinned to one operating system.
#
# The images in `screenshots/` are committed and diffed, so they have to be
# reproducible. Everything inside the browser was already pinned — the clock,
# Math.random, animations, the colour profile — but the font rasteriser was
# not: macOS renders glyphs through CoreText and Linux through FreeType, so the
# same page produces different pixels on different machines. Nothing inside
# Chromium can fix that. The renderer itself has to be the same.
#
# So the whole pipeline runs in here: the mock Plex, the server that serves both
# the API and the built admin UI, and Chromium. Only `screenshots/` and the
# marketing site's copies are mounted back out.
#
# The base tag must match the `playwright` version in the lockfile or the
# driver and the browser disagree about the protocol; scripts/capture-docker.mjs
# reads the installed version and passes it in, rather than leaving two places
# to update by hand.
ARG PLAYWRIGHT_VERSION=1.60.0
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

# `pnpm --filter` and the harness both shell out to git for the UI hash, and
# the base image doesn't ship it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.21.0
WORKDIR /repo

# Dependencies first, keyed only on the manifests, so editing a component
# doesn't reinstall 35 packages. Every workspace member's package.json has to
# be present for `--frozen-lockfile` to resolve the graph.
# CHANGELOG.md is here because apps/web/vite.config.ts inlines it into the
# bundle for the Changelog page, and Vite refuses to start without it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json CHANGELOG.md ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/portal/package.json ./apps/portal/
COPY apps/tinkerbell.dev/package.json ./apps/tinkerbell.dev/
COPY packages/ ./packages/
COPY clients/ ./clients/
COPY domains/ ./domains/

# `--ignore-scripts=false` is the point: better-sqlite3 and sharp resolve their
# native binaries here, for this platform. This is also why the repo is copied
# rather than bind-mounted — a macOS node_modules mounted into Linux would load
# Mach-O objects and die.
RUN pnpm install --frozen-lockfile --ignore-scripts=false

# The browser is already in the base image; installing again would download a
# second copy. Point Playwright at the one that ships here.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Source next, so a UI edit only invalidates from here down.
COPY apps/web/ ./apps/web/
COPY apps/server/ ./apps/server/
COPY apps/portal/ ./apps/portal/
RUN pnpm install --frozen-lockfile --offline --ignore-scripts=false

# The admin UI is served to the browser as a built bundle, not from the dev
# server: unbundled modules cost several hundred requests on each of ~100 page
# loads. Built here rather than at capture time so it lands in a layer, and a
# rerun that changed nothing pays nothing.
# VITE_TB_CAPTURE turns off react-query's polling and retries and keeps the
# dev-only pages the suite documents (see the `define` block in
# apps/web/vite.config.ts). It has to be set now, because Vite inlines it.
RUN VITE_TB_CAPTURE=1 pnpm --filter @tinkerbell/web build
ENV TB_WEB_PREBUILT=1

# The harness itself last: editing a shot shouldn't rebuild the bundle.
COPY apps/tinkerbell.dev/ ./apps/tinkerbell.dev/

# Migrating and seeding the throwaway database writes the same bytes on every
# run, so do it once here and let the capture copy the result. The origin below
# is the mock Plex address the harness binds (MOCK_PORT in capture.ts); it is
# recorded so the harness can check the two still agree, and seed for itself if
# they ever don't.
ENV TB_SEED_TEMPLATE=/repo/.harness-seed
ENV TB_SEED_ORIGIN=http://127.0.0.1:39303
RUN node --experimental-strip-types apps/tinkerbell.dev/harness/prepare-data.ts "$TB_SEED_TEMPLATE" "$TB_SEED_ORIGIN"

# The container runs as the host's uid so the PNGs it writes aren't owned by
# root, but that uid doesn't exist in here and owns none of these files. Only
# the harness's throwaway database needs to be writable — a recursive chmod over
# /repo rewrote every file's metadata, which meant a whole-tree layer to export
# on every build.
RUN chmod a+rwx /repo/apps/tinkerbell.dev

# Chromium's sandbox needs privileges the container doesn't have, and the
# alternative is running the whole thing as root.
ENV TB_CHROMIUM_NO_SANDBOX=1

CMD ["node", "--experimental-strip-types", "apps/tinkerbell.dev/harness/capture.ts"]
