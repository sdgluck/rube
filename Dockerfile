FROM node:22-alpine
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile
COPY index.mjs scheduler.mjs ./
CMD ["node", "scheduler.mjs"]
