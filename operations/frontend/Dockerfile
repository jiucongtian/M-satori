FROM node:22-alpine AS build
WORKDIR /app
COPY operations/frontend/package*.json ./
RUN npm install
COPY operations/frontend .
ARG NEXT_PUBLIC_OPERATIONS_API_BASE=/operations-api
ENV NEXT_PUBLIC_OPERATIONS_API_BASE=$NEXT_PUBLIC_OPERATIONS_API_BASE
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=6900 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
CMD ["node","server.js"]
