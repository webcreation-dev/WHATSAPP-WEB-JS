# Utiliser l'image Node.js officielle
FROM node:18-alpine

# Installer les dépendances système pour Chromium/Puppeteer (requis pour whatsapp-web.js)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Définir les variables d'environnement pour Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Créer le répertoire de l'application
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer toutes les dépendances (dev + prod pour le build)
RUN npm ci

# Copier le reste du code source
COPY . .

# Construire l'application
RUN npm run build

# Nettoyer les devDependencies après le build pour réduire la taille
RUN npm prune --production

# Exposer le port
EXPOSE 3323

# Démarrer l'application
CMD ["npm", "run", "start:prod"]

