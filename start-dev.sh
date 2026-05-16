#!/bin/bash
# PrivoxPTT — быстрый локальный запуск
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

# ─── 1. PostgreSQL ────────────────────────────────────────
if ! pg_isready -q 2>/dev/null; then
  info "Запуск PostgreSQL..."
  brew services start postgresql@16
  sleep 2
else
  info "PostgreSQL уже запущен"
fi

# Создаём пользователя и базу если нет
psql postgres -c "CREATE USER privox WITH PASSWORD 'privox123';" 2>/dev/null || true
psql postgres -c "CREATE DATABASE privoxptt OWNER privox;" 2>/dev/null || true
psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE privoxptt TO privox;" 2>/dev/null || true
info "База данных готова"

# ─── 2. Redis ─────────────────────────────────────────────
if ! redis-cli ping &>/dev/null; then
  info "Запуск Redis..."
  brew services start redis
  sleep 1
else
  info "Redis уже запущен"
fi

# ─── 3. Зависимости сервера ───────────────────────────────
cd "$(dirname "$0")/server"
if [ ! -d node_modules ]; then
  info "npm install (сервер)..."
  npm install
fi

# ─── 4. Prisma ────────────────────────────────────────────
info "Prisma migrate..."
npx prisma migrate dev --name init 2>/dev/null || npx prisma migrate deploy
info "Prisma seed..."
npx ts-node prisma/seed.ts

# ─── 5. Зависимости веб-клиента ───────────────────────────
cd "../web"
if [ ! -d node_modules ]; then
  info "npm install (web)..."
  npm install
fi

# ─── 6. Запуск ────────────────────────────────────────────
cd ..
info "Запуск сервера и веб-клиента..."
echo ""
echo "  Сервер API:   http://localhost:3000"
echo "  Веб-клиент:   http://localhost:5173"
echo ""
echo "  Логин:  admin@privox.tech"
echo "  Пароль: Admin123!"
echo ""
warn "Нажмите Ctrl+C для остановки"
echo ""

# Запускаем оба процесса параллельно
(cd server && npm run dev) &
SERVER_PID=$!
sleep 3
(cd web && npm run dev) &
WEB_PID=$!

trap "kill $SERVER_PID $WEB_PID 2>/dev/null; brew services stop redis; brew services stop postgresql@16; echo 'Остановлено'" INT TERM

wait
