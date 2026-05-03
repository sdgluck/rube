FROM node:25-alpine AS base
RUN npm install -g pnpm@9.15.0
WORKDIR /repo

FROM base AS build
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile
COPY apps/ ./apps/
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @tinkerbell/web run build
RUN pnpm --filter=@tinkerbell/server deploy --prod /out

FROM node:25-alpine
WORKDIR /app
RUN mkdir -p /config

COPY --from=build /out/ ./apps/server/
COPY --from=build /repo/apps/web/dist ./apps/web/dist/

ENV DATA_DIR=/config
ENV NODE_ENV=production
EXPOSE 3000
VOLUME /config

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

WORKDIR /app/apps/server
CMD ["node", "server.ts"]
