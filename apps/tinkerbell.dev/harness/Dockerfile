# Screenshot capture, pinned to one operating system.
#
# The images in `screenshots/` are committed and diffed, so they have to be
# reproducible. Everything inside the browser was already pinned — the clock,
# Math.random, animations, the colour profile — but the font rasteriser was
# not: macOS renders glyphs through CoreText and Linux through FreeType, so the
# same page produces different pixels on different machines. Nothing inside
# Chromium can fix that. The renderer itself has to be the same.
#
# So the whole pipeline runs in here: the mock Plex, the server, Vite and
# Chromium. Only `screenshots/` and the marketing site's copies are mounted
# back out.
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

# Source last, so a UI edit only invalidates from this line down.
COPY apps/ ./apps/
RUN pnpm install --frozen-lockfile --offline --ignore-scripts=false

# The container runs as the host's uid so the PNGs it writes aren't owned by
# root, but that uid doesn't exist in here and owns none of these files. The
# harness needs to write its throwaway database, and Vite its cache, so open
# the tree up rather than guess at a uid at build time.
RUN chmod -R a+rwX /repo

# Chromium's sandbox needs privileges the container doesn't have, and the
# alternative is running the whole thing as root.
ENV TB_CHROMIUM_NO_SANDBOX=1

CMD ["node", "--experimental-strip-types", "apps/tinkerbell.dev/harness/capture.ts"]
