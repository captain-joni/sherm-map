# 1. Base Image
FROM node:20-alpine

# 2. Arbeitsverzeichnis im Container
WORKDIR /usr/src/app

# 3. Package.json & package-lock.json kopieren
COPY package*.json ./

# 4. Dependencies installieren (exakt nach Lockfile, ohne devDependencies)
RUN npm ci --omit=dev && npm cache clean --force

# 5. Restlichen Code kopieren (.dockerignore hält .env, uploads, node_modules raus)
COPY . .
RUN mkdir -p uploads

ENV NODE_ENV=production

# 6. Port freigeben (muss zu docker-compose passen)
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# 7. Startbefehl
CMD ["node", "server.js"]
