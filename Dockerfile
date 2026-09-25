FROM node:20-alpine

WORKDIR /app

# Package files kopieren und installieren
COPY package*.json ./
RUN npm ci --omit=dev

# Source code und statische Dateien kopieren
COPY src/ ./src/
COPY public/ ./public/

# Port freigeben und Cache-Verzeichnis anlegen
ENV PORT=3000
ENV NODE_ENV=production
RUN mkdir -p .cache

EXPOSE 3000

CMD ["node", "src/server.js"]
