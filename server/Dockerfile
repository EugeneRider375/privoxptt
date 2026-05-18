FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip make g++ pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts

RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

# ─── Production образ ─────────────────────────────────────
FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip make g++ pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# Пересобираем mediasoup worker из исходников (не скачиваем prebuilt бинарник)
# Это работает на любой архитектуре (x64 и arm64)
ENV MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD=1
ENV MESON_ARGS="-Dms_disable_liburing=true"

# Не используем --ignore-scripts в production: bcrypt и mediasoup создают native
# бинарники во время install/postinstall. Без них контейнер падает на старте.
RUN npm ci --omit=dev

RUN npm rebuild bcrypt mediasoup

RUN npx prisma generate

COPY --from=builder /app/dist ./dist

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
