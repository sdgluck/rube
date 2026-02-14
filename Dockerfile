FROM node:22-alpine AS frontend
WORKDIR /web
COPY web/package.json web/yarn.lock* ./
RUN yarn install --frozen-lockfile
COPY web/ ./
RUN yarn build

FROM node:22-alpine
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile
COPY index.mjs scheduler.mjs plex.mjs config.mjs server.mjs ./
COPY commands/ ./commands/
COPY --from=frontend /web/dist ./web/dist/
CMD ["node", "scheduler.mjs"]
