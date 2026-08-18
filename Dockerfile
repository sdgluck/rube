FROM node:26-alpine AS base
RUN npm install -g pnpm@11.21.0
WORKDIR /repo

FROM base AS build
# better-sqlite3 compiles from source; sharp downloads a prebuilt libvips but
# still needs a toolchain present if it has to fall back.
RUN apk add --no-cache python3 make g++

# CHANGELOG.md is here because apps/web/vite.config.ts inlines it into the
# bundle for the Changelog page, and Vite refuses to start without it.
#
# tsconfig.base.json is what every packages/*, clients/*, domains/* and
# apps/server tsconfig `extends`. Without it at the context root, Vite's esbuild
# pass fails to resolve the extends chain of the first workspace file it loads.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json CHANGELOG.md tsconfig.base.json tsconfig.node.json ./

# Every workspace member the server's graph touches has to be present before
# `--frozen-lockfile` can resolve it. apps/server pulls in six `domains/*`,
# which in turn reach into `clients/*`; none of that used to be copied, so the
# install saw 17 of 40 projects and the offline pass had nothing to link.
#
# These are source-only TypeScript libraries with no build step, so they are
# copied whole rather than manifest-first: there is no artifact to cache in
# between, and it keeps this file in step with the capture image, which copies
# them the same way.
COPY packages/ ./packages/
COPY clients/ ./clients/
COPY domains/ ./domains/

# The three apps that ship in this image, by name. `COPY apps/` would also
# drag in apps/tinkerbell.dev — the marketing site — whose devDependencies are
# playwright and a second sharp. Nothing here serves it, and pulling it in is
# what made the install reach for a playwright tarball it had no reason to
# want. Manifests first so a source edit doesn't reinstall the world.
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/portal/package.json ./apps/portal/
RUN pnpm install --frozen-lockfile

COPY apps/server/ ./apps/server/
COPY apps/web/ ./apps/web/
COPY apps/portal/ ./apps/portal/

# There is no .git in the build context, so the commit the web bundle reports
# has to be handed in. Unset just means the UI doesn't name a commit.
ARG TB_GIT_SHA=""
ENV TB_GIT_SHA=$TB_GIT_SHA
RUN pnpm --filter @tinkerbell/web run build
RUN pnpm --filter @tinkerbell/portal run build

# The server's production subgraph, resolved on its own rather than pruned out
# of the build stage. Pruning in place doesn't work: `install --prod` unlinks
# devDependencies from each project but leaves their contents in the .pnpm
# virtual store, so turbo, typescript, oxlint and esbuild still ship. Resolving
# from a manifest set that never mentions them keeps them out to begin with.
FROM base AS prod-deps
RUN apk add --no-cache python3 make g++

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json tsconfig.node.json ./
COPY packages/ ./packages/
COPY clients/ ./clients/
COPY domains/ ./domains/
COPY apps/server/ ./apps/server/


# apps/web and apps/portal are deliberately absent: only their built dist/ ends
# up in the image, and omitting them here keeps react and lucide-react (~40 MB)
# out of the store. pnpm resolves a lockfile subset fine — it installs the
# projects it can see and skips the rest.
#
# --ignore-scripts is what makes --prod survivable: the root `prepare` script
# runs husky, which is itself a devDependency, so a production install that
# runs lifecycle scripts fails with ELIFECYCLE. better-sqlite3 is then built
# explicitly, which is the only script that actually had to run. sharp needs
# none — it resolves the prebuilt @img/sharp-libvips-linuxmusl binary at load.
# -r matters: better-sqlite3 belongs to packages/db, not the root project, and
# a non-recursive `pnpm rebuild` silently does nothing here.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
  && pnpm rebuild -r better-sqlite3

# Two things pnpm installs that this image can never execute, ~39 MB together.
#
# sharp declares one prebuilt libvips per platform as optional dependencies and
# pnpm materialises every variant matching os=linux, so the glibc build lands
# beside the musl one Alpine actually loads. `pnpm.supportedArchitectures`
# looks like the supported way to narrow this, but it has no effect under
# --frozen-lockfile — the lockfile already names every variant — so they are
# matched by libc rather than by version, which would rot on the next bump.
#
# typescript is a *required* peerDependency of @trpc/server (`>=5.7.2`), so a
# production install pulls in all 23 MB of it. Nothing loads it: it is a
# types-only peer, and Node 26 strips types with its own built-in stripper
# rather than the compiler. Both removals are covered by the sharp and
# full-router smoke tests below.
RUN find node_modules/.pnpm -maxdepth 1 -name '@img+sharp*' ! -name '*musl*' -exec rm -rf {} + \
  && rm -rf node_modules/.pnpm/typescript@*

# A build-time guard on the two removals above: if either one ever takes
# something the runtime actually needs, fail here rather than in the user's
# container. Exercises the real overlay path (sharp + opentype.js + fonts) and
# forces every tRPC router to load.
RUN cd packages/overlays && node --input-type=module -e "\
import { compositeOverlays } from './src/index.ts'; import sharp from 'sharp';\
const p = await sharp({create:{width:600,height:900,channels:4,background:{r:10,g:10,b:20,alpha:1}}}).jpeg().toBuffer();\
const o = await compositeOverlays(p, [{position:'top-left',type:'imdb_rating',value:'8.4'}]);\
if ((await sharp(o).metadata()).format !== 'jpeg') throw new Error('sharp composite failed');\
console.log('smoke: sharp', sharp.versions.sharp, 'libvips', sharp.versions.vips);"
# The router is built from a container now, so the guard builds one — the same
# two calls the server makes at boot, against a throwaway data directory. That
# makes this a guard on the composition root as well: every domain the graph
# registers has to resolve for the router to exist at all.
RUN cd apps/server && node --input-type=module -e "\
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';\
import { buildContainer, ServicesToken } from '@tinkerbell/composition';\
import { JobsToken, registerJobs } from '@tinkerbell/jobs';\
import { createTrpc } from '@tinkerbell/trpc';\
const c = buildContainer({ dataDir: mkdtempSync(join(tmpdir(), 'tb-smoke-')) }, [registerJobs]);\
const { appRouter } = createTrpc({ ...c.resolve(ServicesToken), jobs: c.resolve(JobsToken) });\
const n = Object.keys(appRouter._def.procedures).length;\
if (n < 100) throw new Error('trpc router did not load fully: ' + n);\
console.log('smoke: trpc router loaded,', n, 'procedures');"

# Tests and fixtures aren't reachable at runtime and the fixtures pull in
# sample images; drop them rather than copy them into the final image.
RUN find packages clients domains -name '*.test.ts' -delete \
  && find packages clients domains -name '__fixtures__' -type d -prune -exec rm -rf {} +

FROM node:26-alpine
# ffmpeg (~80 MB) powers the Prerolls feature: probing uploads and
# normalising anything Plex wouldn't direct play.
RUN apk add --no-cache su-exec tini ffmpeg
WORKDIR /app
RUN mkdir -p /config /prerolls

# The workspace tree, not a `pnpm deploy` bundle. Every @tinkerbell/* package
# is raw TypeScript (`main: ./src/index.ts`) that Node type-strips at load, and
# Node refuses to strip types for any file whose real path is under
# node_modules. pnpm links workspace packages as symlinks, so the real path is
# packages/… and stripping is allowed — but `pnpm deploy` *copies* them in as
# real directories under node_modules, which fails at the first import with
# ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING. Copying the tree keeps pnpm's
# relative symlinks, and with them the layout Node needs.
COPY --from=prod-deps /repo/ ./
# Only the built front-ends, from the stage that had the toolchain to build them.
COPY --from=build /repo/apps/web/dist ./apps/web/dist/
COPY --from=build /repo/apps/portal/dist ./apps/portal/dist/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV DATA_DIR=/config
# Prerolls live on their own volume because Plex has to read them too — mount
# this same directory into the Plex container and set the Plex-side path in
# Settings → Prerolls.
ENV PREROLLS_DIR=/prerolls
ENV NODE_ENV=production
# Container must bind to the container's network interface to be reachable
# from the host. The server defaults to 127.0.0.1 so non-containerised installs
# are safe by default; expose it deliberately here.
ENV HOST=0.0.0.0
ENV PUID=99
ENV PGID=100
# debug | info | warn | error. Raise to `debug` to see per-command job detail
# and the Sidequest engine's own internals in `docker logs`.
ENV LOG_LEVEL=info
# 3000 = admin app/API. 3100 = user portal (Sign in with Plex). USER_HOST
# inherits HOST so the portal is reachable too. The admin app can require a Plex
# sign-in (Settings → Security), but it is off until turned on and an upgrade
# never turns it on — so for a public deployment, expose only 3100 and keep 3000
# on a trusted network.
EXPOSE 3000 3100
VOLUME /config /prerolls

LABEL net.unraid.docker.webui="http://[IP]:[PORT:3000]"
LABEL net.unraid.docker.icon="https://raw.githubusercontent.com/sdgluck/tinkerbell/master/icon.png"
LABEL org.opencontainers.image.source="https://github.com/sdgluck/tinkerbell"

# 127.0.0.1, not localhost: the server binds 0.0.0.0, which is IPv4 only, while
# /etc/hosts maps localhost to ::1 as well and busybox wget tries that first.
# The connection is refused, and the container sits in `unhealthy` forever even
# though it is serving normally.
#
# ${PORT:-3000}, not a literal 3000: the server reads PORT, so a container
# started with PORT set to anything else would otherwise sit `unhealthy`
# forever while serving normally.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/" || exit 1

WORKDIR /app/apps/server
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/server.ts"]
