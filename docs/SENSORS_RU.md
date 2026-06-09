# PrivoxPTT — Интеграция датчиков (Sensors)

Документ описывает фичу «датчик → тревога → дашборд/push»: что сделано, как
устроено, как добавлять датчики и план дальнейших работ.

Дата: 2026-06-09. Ветка разработки: `feature/sensors`.

---

## 1. Идея

Реализуем обещание сайта privox.tech: единый слой **голос + датчики +
диспетчеризация**. Датчик ловит событие (превышение температуры, влажности,
пропажа данных) → PrivoxPTT мгновенно показывает тревогу диспетчеру и шлёт
push в группу. Голос (TTS/авто-вызов) — отложен.

**Принцип firmware-free:** прошивки и бэкенды датчиков НЕ трогаются. PrivoxPTT
сам опрашивает их публичные HTTP-API.

---

## 2. Статус (что сделано)

| Компонент | Статус |
|-----------|--------|
| Модели БД `Sensor` + `SensorReading` + миграция | ✅ |
| Поллер (опрос каждые 15 c) + адаптеры | ✅ |
| Пороги тревог per-sensor (JSON) | ✅ |
| Edge-trigger (тревога только на переходе) + STALE-детект | ✅ |
| `sensor-update` / `sensor-alert` в Socket.IO | ✅ |
| FCM-push в группу при тревоге | ✅ |
| Панель «SENSORS» на дашборде диспетчера | ✅ |
| Сид 3 датчиков (Frigo + HomeClimate) | ✅ |
| Прод-сид в `docker-entrypoint.sh` | ✅ |
| **API/UI добавления датчиков (`routes/sensors.ts`, админ-страница)** | ❌ отложено |
| **Стандартный `POST /api/telemetry`** | ❌ отложено |
| **Голос в канал (TTS/авто-вызов)** | ❌ отложено |
| **Тонкая видимость per-group** | ❌ отложено (пока вся орг) |

---

## 3. Архитектура

### Поток данных
```
Внешний датчик (Frigo / HomeClimate)  — присылает данные на СВОЙ облачный API
        │
        │  PrivoxPTT-сервер: sensorPoller каждые 15 c делает GET sourceUrl
        ▼
   адаптер нормализует ответ → { temperature, humidity, observedAt }
        │
   проверка STALE (>20 мин нет данных) и порогов
        │
        ├─ всегда:           io.emit('sensor-update', org:<id>)   → живые карточки
        └─ на переходе OK→ALERT/STALE (edge-trigger):
              io.emit('sensor-alert', org:<id> + group:<groupId>) → красная тревога
              FCM push участникам группы датчика
```

### Модели БД (`server/prisma/schema.prisma`)
- `Sensor` — `organizationId`, `name`, `kind` (FRIDGE/OUTDOOR/INDOOR),
  `adapter` (FRIGO/HOMECLIMATE), `sourceUrl`, `externalId`, `thresholds` (JSON),
  `lat/lng`, `groupId`, `lastValue` (JSON), `lastSeenAt`, `status`
  (OK/ALERT/STALE), `enabled`.
- `SensorReading` — история замеров (`temperature`, `humidity`, `raw`).

### Адаптеры (`server/src/services/sensors/adapters.ts`)
- `normalizeFrigo` — `GET frigo.privox.tech/api/stats` → `{current, last_seen}`.
- `normalizeHomeclimate` — `GET temperature.privox.tech/api/latest` → массив
  `[{sensor_id, temperature, humidity, temp_valid, hum_valid, created_at}]`
  (externalId: `1`=Улица, `2`=Дом).
- `evaluateThresholds` — проверяет значение против правил, возвращает причины.

### Пороги (`thresholds` JSON, per-sensor)
```jsonc
{ "temperature": { "min": 2, "max": 8 },   // тревога если <min или >max
  "humidity":    { "max": 70 } }
```
Любую границу можно опустить. Метрики универсальны — добавление новой
(CO₂, протечка, вибрация) не требует миграции БД.

Текущие пороги:
- Холодильник: t < 2 или t > 8 °C
- Дом: t < 10 °C или влажность > 70 %
- Улица: только инфо (без порогов)
- STALE: молчание > 20 мин (ловит реальные поломки датчика)

### Ключевые файлы
- `server/src/services/sensorPoller.ts` — поллер, edge-trigger, emit.
- `server/src/services/sensors/adapters.ts` — нормализация + пороги.
- `server/src/services/push.ts` — `sendSensorAlertPushToUsers` (дописана).
- `server/src/index.ts` — `startSensorPoller(io)` (graceful, как startUdpBridge).
- `server/prisma/seed-sensors.ts` — идемпотентный сид (org по slug).
- `server/docker-entrypoint.sh` — прод-сид после `migrate deploy`.
- `web/src/components/dispatcher/SensorPanel.tsx` — панель датчиков.
- `web/src/hooks/useSocket.ts` — слушатели `sensor-update`/`sensor-alert`.
- `web/src/store/useStore.ts` — `sensors` + `upsertSensor`.

---

## 4. Governance-модель (роли) — согласована, реализация отложена

Два слоя: (1) ПОДКЛЮЧЕНИЕ устройства (технический, редко); (2) КОНФИГУРАЦИЯ и
ДОСТУП (бизнесовый, часто).

| Роль | Полномочия |
|------|-----------|
| **SUPERADMIN** | Регистрирует новое физ-устройство (источник/адаптер/ключ). Только он. |
| **ADMIN** предприятия | Список своих датчиков, задаёт пороги, привязка к группам, выдаёт диспетчерам видимость, вкл/выкл. Без тех-деталей. |
| **DISPATCHER** | Только мониторит и реагирует. |

Изоляция предприятий уже работает: поллер шлёт строго в `org:<organizationId>`
конкретного датчика.

---

## 5. Как добавить датчик СЕЙЧАС (до готовности UI)

Пока самообслуживания нет — добавление через сид/БД (делает разработчик):

1. **Известный тип** (FRIGO/HOMECLIMATE) — дописать в `seed-sensors.ts` объект:
   ```ts
   { name: 'Морозильник', kind: 'FRIDGE', adapter: 'FRIGO',
     sourceUrl: 'https://frigo2.privox.tech/api/stats', externalId: null,
     thresholds: { temperature: { min: -25, max: -16 } }, groupId: 'group-emergency' }
   ```
   Запустить `npx ts-node prisma/seed-sensors.ts`. Поллер подхватит в след. цикл.
2. **Новый тип источника** — плюс новый адаптер в `adapters.ts` и значение enum
   `SensorAdapter`.

---

## 6. Деплой

Прод раскатывается так (см. `docs/` / память):
1. merge `feature/sensors` → `main` → push в GitHub.
2. Coolify: вручную **Deploy** (пересборка контейнеров `server` + `web`).
3. На старте контейнера `server` (`docker-entrypoint.sh`):
   - `npx prisma migrate deploy` → создаёт таблицы `sensors`/`sensor_readings`;
   - сид суперадмина (как было) + **сид 3 датчиков** (идемпотентно, org по slug
     `privox`, группа только если существует);
   - `startSensorPoller(io)` стартует опрос.
4. Контейнер `web` пересобирается → панель SENSORS появляется у диспетчера.

**Откат:** тег `pre-sensors-2026-06-09` (commit `ae798a8`) + в Coolify redeploy
предыдущего билда. Фича аддитивна и graceful (поллер в try/catch) — риск низкий.

---

## 7. План дальнейших действий (roadmap)

Приоритет сверху вниз:

1. **`routes/sensors.ts`** — REST под `requireAdmin`:
   `GET /api/sensors` (список своей орг), `POST/PATCH/DELETE`,
   правка `thresholds` и `groupId`. Регистрация устройства (источник/адаптер) —
   под SUPERADMIN.
2. **Админ-страница «Датчики»** (по образцу `AdminGroups`/`AdminUsers`):
   список, создание (для SUPERADMIN), пороги, привязка к группе, вкл/выкл.
3. **Стандартный `POST /api/telemetry`** — push-контракт
   `{ sensorKey, metrics: { temperature, humidity, ... }, ts }` для plug-and-play
   подключения новых устройств без кода.
4. **Тонкая видимость per-group** — диспетчер видит только датчики своих групп
   (сейчас — вся орг). Меняет таргетинг emit с `org:` на группы.
5. **Координаты датчиков (lat/lng)** → маркеры на `DispatcherMap`.
6. **Голос в канал** — TTS-объявление или авто-вызов группы при критичной тревоге.
7. **История/графики** по `SensorReading` (как у Frigo).

---

## 8. Заметки для разработчика

- В dev (vite) сокет ходит через прокси на `:3000`; `web/.env` пуст. Если в
  браузере «0 online» и нет датчиков — вероятно протух access-токен в
  persisted-сессии (REST оживает через refresh, socket.io — нет). Лечится
  ре-логином.
- Сервер не логирует HTTP-запросы (нет morgan/pino-http) — пустой лог не значит
  «запросов нет».
- «N online» внизу колонки CHANNELS — онлайн-ПОЛЬЗОВАТЕЛИ (не датчики).
