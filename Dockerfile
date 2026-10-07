# Sherm Map v2: Frontend bauen, dann schlankes Laufzeit-Image (Backend + gebautes Frontend)

# 1. Abhängigkeiten (alle, auch dev, für den Frontend-Build)
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci

# 2. Frontend bauen
FROM deps AS build
COPY tsconfig.base.json ./
COPY shared shared
COPY web web
RUN npm run build -w web

# 3. Laufzeit: nur Backend-Abhängigkeiten, läuft nicht als root
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci --omit=dev -w backend -w shared && npm cache clean --force
COPY shared shared
COPY backend/src backend/src
COPY db/migrations db/migrations
COPY --from=build /app/web/dist web/dist
RUN mkdir -p uploads backups && chown node:node uploads backups
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "--import", "tsx", "backend/src/server.ts"]
