FROM node:20-slim AS builder

# Все build tools нужны для сборки mediasoup worker (C++ binary)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip make g++ pkg-config ninja-build \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# Собираем ВСЕ зависимости включая mediasoup worker binary
RUN npm ci

# Генерируем Prisma client
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

# ─── Production образ ─────────────────────────────────────
FROM node:20-slim AS production

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# Только prod-зависимости без скриптов (быстро)
RUN npm ci --only=production --ignore-scripts

# Берём уже собранный mediasoup worker binary из builder-stage
COPY --from=builder /app/node_modules/mediasoup/worker/out /app/node_modules/mediasoup/worker/out

RUN npx prisma generate

COPY --from=builder /app/dist ./dist

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
