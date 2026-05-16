# PrivoxPTT — Server

Node.js + TypeScript сервер для системы Push-to-Talk связи.

## Требования

- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- Python 3 + make + g++ (для сборки MediaSoup)

## Быстрый старт (разработка)

```bash
# 1. Установить зависимости
cd server
npm install

# 2. Создать .env из примера
cp .env.example .env
# Заполните DATABASE_URL, JWT_SECRET, REFRESH_TOKEN_SECRET

# 3. Запустить PostgreSQL и Redis (Docker)
docker run -d --name privox-pg -e POSTGRES_USER=privox -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=privoxptt -p 5432:5432 postgres:16-alpine
docker run -d --name privox-redis -p 6379:6379 redis:7-alpine

# 4. Применить миграции и запустить seed
npx prisma migrate dev --name init
npx ts-node prisma/seed.ts

# 5. Запустить сервер в dev режиме
npm run dev
```

Сервер будет доступен на http://localhost:3000

## Структура

```
src/
├── index.ts              # Точка входа, bootstrap
├── config/index.ts       # Переменные окружения (Zod валидация)
├── database/
│   ├── prisma.ts         # Prisma клиент
│   └── redis.ts          # Redis клиент + PTT/presence хелперы
├── middleware/
│   ├── auth.ts           # JWT verify, requireRole
│   └── errorHandler.ts   # Централизованная обработка ошибок
├── routes/
│   ├── auth.ts           # POST /api/auth/login|logout|refresh, GET /me
│   ├── organizations.ts  # CRUD /api/orgs
│   ├── users.ts          # CRUD /api/users + смена пароля
│   └── groups.ts         # CRUD /api/groups + участники
├── socket/
│   ├── index.ts          # Socket.io setup + JWT auth middleware
│   ├── presence.ts       # Онлайн/офлайн статусы
│   └── ptt.ts            # PTT логика, личные вызовы, WebRTC сигналинг
├── mediasoup/
│   ├── server.ts         # Worker менеджер, создание роутеров
│   ├── transport.ts      # PeerTransportManager (produce/consume)
│   └── router.ts         # Socket.io события MediaSoup
└── utils/logger.ts       # Pino логгер
```

## API

### Авторизация

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/auth/login` | Вход, возвращает `accessToken` + `refreshToken` |
| POST | `/api/auth/logout` | Выход, инвалидация токена |
| POST | `/api/auth/refresh` | Обновление токена (ротация) |
| GET | `/api/auth/me` | Профиль текущего пользователя |

### Пользователи

| Метод | Путь | Роль |
|-------|------|------|
| GET | `/api/users` | ADMIN+ |
| GET | `/api/users/online` | USER+ |
| GET | `/api/users/:id` | USER+ |
| POST | `/api/users` | ADMIN+ |
| PUT | `/api/users/:id` | USER (свой) / ADMIN+ |
| POST | `/api/users/:id/change-password` | USER (свой) |
| POST | `/api/users/:id/reset-password` | ADMIN+ |
| DELETE | `/api/users/:id` | ADMIN+ |

### Группы

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/groups` | Мои группы |
| GET | `/api/groups/:id` | Группа + участники + PTT статус |
| POST | `/api/groups` | Создать (ADMIN+) |
| PUT | `/api/groups/:id` | Обновить (ADMIN+) |
| DELETE | `/api/groups/:id` | Удалить (ADMIN+) |
| POST | `/api/groups/:id/members` | Добавить участника |
| DELETE | `/api/groups/:id/members/:userId` | Удалить участника |
| PATCH | `/api/groups/:id/members/:userId` | Изменить canSpeak |

## Socket.io события

### Клиент → Сервер

```typescript
// Подключение к группе
socket.emit('join-group', { groupId })
socket.emit('leave-group', { groupId })

// PTT (Push-to-Talk)
socket.emit('ptt-start', { groupId })   // Захватить канал
socket.emit('ptt-stop', { groupId })    // Освободить канал

// Личные вызовы
socket.emit('private-call-start', { targetUserId })
socket.emit('private-call-end', { targetUserId })

// WebRTC сигналинг (p2p fallback)
socket.emit('webrtc-offer', { targetId, sdp })
socket.emit('webrtc-answer', { targetId, sdp })
socket.emit('webrtc-ice', { targetId, candidate })

// MediaSoup (SFU)
socket.emit('ms:get-rtp-capabilities', { groupId }, callback)
socket.emit('ms:create-send-transport', { groupId }, callback)
socket.emit('ms:create-recv-transport', { groupId }, callback)
socket.emit('ms:connect-send-transport', { groupId, dtlsParameters }, callback)
socket.emit('ms:connect-recv-transport', { groupId, dtlsParameters }, callback)
socket.emit('ms:produce', { groupId, rtpParameters }, callback)
socket.emit('ms:consume', { groupId, producerId, rtpCapabilities }, callback)
socket.emit('ms:get-producers', { groupId }, callback)

// Heartbeat (каждые 30 сек)
socket.emit('heartbeat')
```

### Сервер → Клиент

```typescript
socket.on('user-online', { userId, callsign, displayName })
socket.on('user-offline', { userId, callsign })
socket.on('channel-busy', { groupId, userId, callsign, displayName })
socket.on('channel-free', { groupId })
socket.on('channel-locked', { groupId, lockedBy, lockedByCallsign, reason, message })
socket.on('incoming-call', { fromId, fromCallsign, fromDisplayName })
socket.on('call-ended', { fromId })
socket.on('ms:new-producer', { groupId, producerId, producerUserId, callsign })
socket.on('ms:producer-closed', { groupId, producerId, producerUserId })
socket.on('heartbeat-ack', { timestamp })
```

## Роли пользователей

| Роль | Описание |
|------|----------|
| `SUPERADMIN` | Полный доступ ко всей системе, все организации |
| `ADMIN` | Управление своей организацией (пользователи, группы) |
| `DISPATCHER` | Видит все группы организации, говорит в любую |
| `USER` | Только свои группы, ограниченные права |

## Производство (Docker)

```bash
# Скопируйте .env.example → .env и заполните
cp .env.example .env

# Сборка и запуск
docker-compose up -d

# Логи сервера
docker-compose logs -f server

# Prisma Studio (локально)
cd server && npx prisma studio
```

## PM2 (без Docker)

```bash
# После сборки
npm run build

# Запуск
pm2 start ecosystem.config.js

# Статус
pm2 status

# Логи
pm2 logs privoxptt
```
