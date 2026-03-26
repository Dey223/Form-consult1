# ============================================================
# Dockerfile — FormConsult (mode développement)
# ============================================================
# On n'utilise pas "next build" ici car certaines librairies
# (Stripe, Mux) s'initialisent au niveau du module et nécessitent
# de vraies clés API au moment du build.
# En production réelle, on injecterait les vraies clés via
# des secrets GitHub Actions ou AWS Secrets Manager.
# ============================================================

FROM node:20-alpine

WORKDIR /app

# Copie des fichiers de dépendances
COPY package*.json ./
COPY prisma ./prisma

# Installation des dépendances
RUN npm ci

# Copie du code source
COPY . .

# Génération du client Prisma pour Alpine Linux
RUN npx prisma generate

# Port exposé
EXPOSE 3000

# Lancement en mode dev
CMD ["npm", "run", "dev"]
