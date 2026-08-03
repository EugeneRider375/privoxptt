# PRIVOX — Подключённые ресурсы и сервисы (инвентарь)

Зафиксировано 2026-06-10. Что подключено, для чего, что хранится, где логиниться.
**Сами логины/пароли — в `docs/SECRETS.local.md` (в .gitignore, НЕ в git).**

> ⚠️ Этот файл — инвентарь без секретов. Не пушить мусором в `main` (пуш = авто-деплой).

---

## 1. Код / GitHub (аккаунт `EugeneRider375`)

| Репозиторий | Назначение | Приватность |
|---|---|---|
| `github.com/EugeneRider375/privoxptt` | Основной проект: server (Node) + web (React) + android | (проверить private/public) |
| `github.com/EugeneRider375/privox-mini-radio` | Прошивка мини-рации ESP32-S3 (DevKitC + SuperMini) + docs | private |

Остальные проекты (HomeClimate, Frigo) — отдельные репо/папки (см. ниже).

## 2. Инфраструктура (прод PrivoxPTT)

| Ресурс | Что это / для чего | Что хранится |
|---|---|---|
| **Hetzner VPS** `178.105.165.22` | Хост прода, Docker | все контейнеры ниже |
| **Coolify** `coolify.privox.tech` | Оркестрация/деплой. **Авто-деплой по webhook при пуше в `main`** | конфиг приложения, env-переменные (секреты) |
| контейнер `server` (Node.js) | API + Socket.IO + MediaSoup SFU (workers:2) | — |
| контейнер `web` (nginx SPA) | Раздаёт React, проксирует /api и /socket.io | — |
| контейнер `db` (Postgres 16) | Главная БД | users, groups, messages, **sensors**, devices (push-токены) |
| контейнер `redis` (7) | Presence / состояние сокетов | онлайн-статусы |
| `coolify-proxy` (Traefik) | Маршрутизация доменов → контейнеры | — (при зависании: `docker restart coolify-proxy`) |
| **UDP bridge** `178.105.165.22:5055` | Приём аудио от мини-раций (ESP32) | — |

## 3. Push-уведомления

| Ресурс | Для чего | Что хранится / где секрет |
|---|---|---|
| **Firebase (FCM)** | Push: пробуждение вызовов + **тревоги датчиков** | FCM-проект; service-account JSON в env `FIREBASE_SERVICE_ACCOUNT_JSON` (Coolify). Device-токены — в Postgres |

## 4. Домены (DNS privox.tech)

| Домен | Куда ведёт |
|---|---|
| `ptt.privox.tech` | Приложение (web-контейнер через Coolify-прокси) |
| `privox.tech` / `/en` | Лендинг |
| `coolify.privox.tech` | Панель Coolify |
| `frigo.privox.tech` | Дашборд/API датчика холодильника (Frigo) |
| `temperature.privox.tech` | Дашборд/API HomeClimate (улица/дом) |

## 5. Датчики (внешние системы, интегрированы поллингом)

| Система | Стек / хостинг | API | Алерты |
|---|---|---|---|
| **Frigo** (холодильник) | ESP8266 → **Railway** (FastAPI + БД) → frigo.privox.tech | `/api/temp` (POST), `/api/stats`, `/api/history` | **Telegram-бот** |
| **HomeClimate** (улица/дом) | ESP32 (ESP-NOW) → WeMos-приёмник → Node.js → temperature.privox.tech | `/api/data` (POST), `/api/latest`, `/api/history` | — |
| **PrivoxPTT sensor poller** | опрашивает frigo/temperature API каждые 15с | (firmware-free) | дашборд + FCM push |

> Цель (бэклог B6): свести все датчики в единую систему. Сейчас у каждого свой сайт.

## 6. Прочее

| Ресурс | Для чего | Где секрет |
|---|---|---|
| **Telegram-бот** (Frigo) | Алерты по температуре холодильника | `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` в env Frigo (Railway) |
| **Railway** | Хостинг бэкенда Frigo | аккаунт — см. SECRETS.local.md |

---

## Env-переменные PrivoxPTT (server, в Coolify) — значения в SECRETS.local.md
`SERVER_IP`, `DOMAIN`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`,
`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `MEDIASOUP_WORKERS`,
`FIREBASE_SERVICE_ACCOUNT_JSON`, `SERVICE_URL_WEB`, CORS origins.

## Что проверить/заполнить (TODO)
- [ ] Приватность репо `privoxptt` (private?).
- [ ] Аккаунты Hetzner / Firebase console / Railway — на какой email.
- [ ] Где именно хостится HomeClimate-сервер (VPS? Railway? другой).
