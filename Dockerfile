FROM node:26-alpine AS base
RUN npm install -g pnpm@9.15.0
WORKDIR /repo

FROM base AS build
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/portal/package.json ./apps/portal/
COPY packages/db/package.json ./packages/db/
RUN pnpm install --frozen-lockfile
COPY apps/ ./apps/
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @tinkerbell/web run build
RUN pnpm --filter @tinkerbell/portal run build
RUN pnpm --filter=@tinkerbell/server deploy --prod /out

FROM node:26-alpine
# ffmpeg (~80 MB) powers the Prerolls feature: probing uploads and
# normalising anything Plex wouldn't direct play.
RUN apk add --no-cache su-exec tini ffmpeg
WORKDIR /app
RUN mkdir -p /config /prerolls

COPY --from=build /out/ ./apps/server/
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
# 3000 = admin app/API (unauthenticated). 3100 = user portal (Sign in with
# Plex). USER_HOST inherits HOST so the portal is reachable too. For a public
# deployment, expose only 3100 and keep 3000 on a trusted network.
EXPOSE 3000 3100
VOLUME /config /prerolls

LABEL net.unraid.docker.webui="http://[IP]:[PORT:3000]"
LABEL net.unraid.docker.icon="https://raw.githubusercontent.com/sdgluck/tinkerbell/master/icon.png"
LABEL org.opencontainers.image.source="https://github.com/sdgluck/tinkerbell"

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

WORKDIR /app/apps/server
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/server.ts"]
