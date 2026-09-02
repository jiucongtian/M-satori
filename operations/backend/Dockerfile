FROM node:22-alpine AS build
WORKDIR /app
COPY operations/backend/package*.json ./
RUN npm install
COPY operations/backend .
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY operations/backend/package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node","dist/server.js"]
