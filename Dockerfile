FROM node:25-alpine AS frontend
WORKDIR /web
COPY web/package.json web/yarn.lock* ./
RUN yarn install --frozen-lockfile
COPY web/ ./
RUN yarn build

FROM node:25-alpine
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile
COPY index.ts scheduler.ts plex.ts config.ts server.ts trpc.ts collections.ts jobs.ts ./
COPY commands/ ./commands/
COPY --from=frontend /web/dist ./web/dist/
CMD ["node", "scheduler.ts"]
