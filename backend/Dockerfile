FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine AS runtime

ENV NODE_ENV=test
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER node
CMD ["node", "dist/apps/api/src/main.js"]

FROM build AS migration

ENV NODE_ENV=test
USER node
CMD ["node_modules/.bin/drizzle-kit", "migrate", "--config=drizzle.production.config.ts"]
