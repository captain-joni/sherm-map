# 1. Base Image
FROM node:20-alpine

# 2. Arbeitsverzeichnis im Container
WORKDIR /usr/src/app

# 3. Package.json & package-lock.json kopieren
COPY package*.json ./

# 4. Dependencies installieren
RUN npm install --production

# 5. Restlichen Code kopieren
COPY . .

# 6. Port freigeben (muss zu docker-compose passen)
EXPOSE 3000

# 7. Startbefehl
CMD ["node", "server.js"]
