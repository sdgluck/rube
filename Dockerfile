FROM node:25-alpine AS frontend
WORKDIR /web
COPY web/package.json web/yarn.lock* ./
RUN yarn install --frozen-lockfile
COPY web/ ./
RUN yarn build

FROM node:25-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile

FROM node:25-alpine
WORKDIR /app

RUN mkdir -p /config

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server/ ./server/
COPY shared/ ./shared/
COPY --from=frontend /web/dist ./web/dist/

ENV DATA_DIR=/config
EXPOSE 3000
VOLUME /config

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server/server.ts"]
