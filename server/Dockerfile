# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Install all workspace deps (needed for tsc)
RUN npm ci --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY server/ ./server/
COPY prisma/ ./prisma/

# Generate Prisma client
RUN npx prisma generate --schema=prisma/schema.prisma

# Compile shared first, then server
RUN npm run build -w shared
RUN npm run build -w server

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Production deps only — must NOT use --ignore-scripts so bcrypt native binding compiles
RUN npm ci --omit=dev

# Copy compiled output and prisma schema/migrations
COPY --from=builder /build/server/dist ./server/dist
COPY --from=builder /build/node_modules/.prisma ./node_modules/.prisma
COPY prisma/ ./prisma/

# Copy compiled shared package so workspace resolution finds dist/
COPY --from=builder /build/shared/dist ./shared/dist
COPY --from=builder /build/shared/package.json ./shared/package.json

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
