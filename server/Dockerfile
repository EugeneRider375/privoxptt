FROM node:20-alpine AS builder

# MediaSoup требует Python и make для сборки нативных модулей
RUN apk add --no-cache python3 py3-pip make g++ linux-headers

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
FROM node:20-alpine AS production

RUN apk add --no-cache python3 py3-pip make g++ linux-headers

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production --ignore-scripts

# Пересобираем нативные модули (mediasoup)
RUN npm rebuild

RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# Скрипт запуска: миграции + seed + старт
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
