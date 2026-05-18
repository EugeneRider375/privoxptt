FROM node:20-slim AS builder

# MediaSoup требует Python, make, g++, pkg-config для сборки нативных модулей
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip make g++ pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts

# Генерируем Prisma client
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

# ─── Production образ ─────────────────────────────────────
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip make g++ pkg-config ninja-build \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# Без --ignore-scripts: mediasoup должен запустить postinstall и собрать воркер
RUN npm ci --only=production

RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# Скрипт запуска: миграции + seed + старт
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
