FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# VITE_ переменные встраиваются в бандл при сборке.
# Дефолты уже правильные для прода:
#   VITE_API_URL  = '/api'  (relative → nginx proxy)
#   VITE_SOCKET_URL = ''    (socket.io подключается к текущему origin)
RUN npm run build

# ─── Production: nginx ────────────────────────────────────
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
