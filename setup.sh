#!/bin/bash
# PrivoxPTT — установочный скрипт для Ubuntu 22.04 LTS
# Запуск: sudo bash setup.sh
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

[ "$(id -u)" -ne 0 ] && error "Запустите скрипт от root: sudo bash setup.sh"

# ─── Конфигурация ─────────────────────────────────────────
read -rp "Введите IP адрес сервера: " SERVER_IP
read -rp "Введите домен (например ptt.privox.tech): " DOMAIN
read -rp "Email суперадмина [admin@privox.tech]: " SUPERADMIN_EMAIL
SUPERADMIN_EMAIL=${SUPERADMIN_EMAIL:-admin@privox.tech}
read -rsp "Пароль суперадмина: " SUPERADMIN_PASSWORD; echo
read -rsp "Пароль PostgreSQL: " POSTGRES_PASSWORD; echo
JWT_SECRET=$(openssl rand -hex 32)
REFRESH_SECRET=$(openssl rand -hex 32)

info "=== 1. Обновление системы ==="
apt-get update && apt-get upgrade -y

info "=== 2. Установка зависимостей ==="
apt-get install -y curl git build-essential python3 make g++ ufw certbot python3-certbot-nginx

info "=== 3. Установка Node.js 20 ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v

info "=== 4. Установка PostgreSQL 16 ==="
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql

sudo -u postgres psql <<SQL
CREATE USER privox WITH PASSWORD '${POSTGRES_PASSWORD}';
CREATE DATABASE privoxptt OWNER privox;
GRANT ALL PRIVILEGES ON DATABASE privoxptt TO privox;
SQL

info "=== 5. Установка Redis 7 ==="
apt-get install -y redis-server
sed -i 's/^supervised no/supervised systemd/' /etc/redis/redis.conf
systemctl enable --now redis-server

info "=== 6. Установка PM2 ==="
npm install -g pm2
pm2 startup systemd -u "$SUDO_USER" --hp "/home/$SUDO_USER"

info "=== 7. Установка Nginx ==="
apt-get install -y nginx
systemctl enable --now nginx

info "=== 8. Настройка фаервола ==="
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw allow 10000:10100/udp
ufw allow 10000:10100/tcp
ufw --force enable

info "=== 9. Клонирование проекта ==="
APP_DIR="/opt/privoxptt"
mkdir -p "$APP_DIR"
# Если уже скачан — просто копируем
if [ -d "./server" ]; then
  cp -r . "$APP_DIR/"
else
  info "Скопируйте файлы проекта в $APP_DIR вручную или используйте git clone"
fi

info "=== 10. Установка зависимостей сервера ==="
cd "$APP_DIR/server"

# Создаём .env
cat > .env <<ENV
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://privox:${POSTGRES_PASSWORD}@localhost:5432/privoxptt
REDIS_URL=redis://localhost:6379
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_SECRET=${REFRESH_SECRET}
REFRESH_TOKEN_EXPIRES_IN=30d
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=${SERVER_IP}
MEDIASOUP_MIN_PORT=10000
MEDIASOUP_MAX_PORT=10100
MEDIASOUP_NUM_WORKERS=2
CORS_ORIGINS=https://${DOMAIN},http://localhost:5173
SUPERADMIN_EMAIL=${SUPERADMIN_EMAIL}
SUPERADMIN_PASSWORD=${SUPERADMIN_PASSWORD}
SUPERADMIN_CALLSIGN=ALPHA-0
ENV

npm ci
npx prisma generate
npx prisma migrate deploy
npx ts-node prisma/seed.ts
npm run build

info "=== 11. Настройка PM2 ==="
cat > "$APP_DIR/ecosystem.config.js" <<ECOSYSTEM
module.exports = {
  apps: [{
    name: 'privoxptt',
    script: './server/dist/index.js',
    cwd: '$APP_DIR',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/var/log/privoxptt/error.log',
    out_file: '/var/log/privoxptt/out.log',
  }]
};
ECOSYSTEM

mkdir -p /var/log/privoxptt
pm2 start "$APP_DIR/ecosystem.config.js"
pm2 save

info "=== 12. Настройка Nginx ==="
cat > "/etc/nginx/sites-available/${DOMAIN}" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    # WebSocket для Socket.io
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }

    # API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Healthcheck
    location /health {
        proxy_pass http://localhost:3000;
    }
}
NGINX

ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/"
nginx -t && systemctl reload nginx

info "=== 13. SSL сертификат (Let's Encrypt) ==="
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$SUPERADMIN_EMAIL" || \
  warn "Не удалось получить SSL. Настройте DNS и запустите: certbot --nginx -d $DOMAIN"

info "=== Установка завершена! ==="
echo ""
echo -e "${GREEN}PrivoxPTT успешно установлен!${NC}"
echo ""
echo "Сервер API:  https://${DOMAIN}/api"
echo "Healthcheck: https://${DOMAIN}/health"
echo "PM2 статус:  pm2 status"
echo "Логи:        pm2 logs privoxptt"
echo ""
echo "JWT_SECRET и REFRESH_TOKEN_SECRET сохранены в ${APP_DIR}/server/.env"
echo ""
warn "ВАЖНО: Сохраните .env файл в безопасном месте!"
