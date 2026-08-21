# Рабочее место: как развернуть проект на новой машине

Проект живёт в `~/Projects/PrivoxPTT`. **Не на Рабочем столе** — он
синхронизируется с iCloud, а тот плодит дубликаты вида `файл 2.ts`. Такие
однажды попали в репозиторий и ломали сборку Android («Duplicate resources»),
а 21.08.2026 остановили сборку APK на 65 файлах-дубликатах.

---

## 1. Что ставится один раз

```bash
# Homebrew — требует пароль администратора, запускать самому в Терминале
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

Для Android дополнительно нужен Android Studio (ради SDK и JDK 21).
Для iOS — Xcode 26.2+, то есть macOS 26 и новее.

## 2. Копия проекта

```bash
mkdir -p ~/Projects && cd ~/Projects
git clone https://github.com/EugeneRider375/privoxptt.git PrivoxPTT
cd PrivoxPTT
(cd server && npm ci && npx prisma generate)
(cd web && npm ci --legacy-peer-deps)   # --legacy-peer-deps обязателен, см. D4
(cd android && npm ci)
```

## 3. Файлы, которых нет в git

В репозитории их нет намеренно — там пароли и ключи. Переносить с рабочей
машины вручную, по одному разу:

```
server/.env                          ключи JWT, пароль базы, токен Telegram
web/.env
android/phone/keystore.properties    пароль от ключа подписи
android/t320/keystore.properties
android/phone/local.properties       путь к Android SDK — свой на каждой машине
android/t320/local.properties
android/phone/app/google-services.json   настройки Firebase
android/t320/app/google-services.json
```

**Ключ подписи** `privox-release.keystore` лежит отдельно, вне репозитория:
`~/PrivoxKeys/` и копия на Рабочем столе (то есть в iCloud — это осознанно,
как резервная копия). Путь к нему прописан в `keystore.properties`, при
переносе на другую машину путь поправить.

Потерять ключ или его пароль = потерять возможность обновлять приложение
навсегда. Пароль хранить **отдельно** от файла ключа.

## 4. Локальная база

```bash
psql -d postgres -c "CREATE DATABASE privoxptt_prodcopy OWNER privox;"
gunzip -c ~/Desktop/privoxptt-*.sql.gz | psql -U privox -h 127.0.0.1 -d privoxptt_prodcopy -q
(cd server && DATABASE_URL='postgresql://privox:privox123@127.0.0.1:5432/privoxptt_prodcopy' npx prisma migrate deploy)
```

## 5. Запуск

```bash
# сервер
cd server && DATABASE_URL='postgresql://privox:privox123@127.0.0.1:5432/privoxptt_prodcopy' \
  PORT=3000 MEDIASOUP_NUM_WORKERS=1 npx ts-node-dev --respawn --transpile-only src/index.ts

# веб (в другом окне)
cd web && npm run dev
```

⚠️ `MEDIASOUP_ANNOUNCED_IP` в `server/.env` должен быть **реальным адресом
машины в сети**, а не `127.0.0.1`. Иначе разговор «соединяется», но звука нет
ни в каком режиме: сигнализация идёт по HTTP и работает, а звук уходит на
петлевой адрес чужого устройства.

---

## Работа на двух компьютерах

Синхронизация — **через GitHub**, не через облако:

```
поработал → git push
на другой машине → git pull → поработал → git push
```

⚠️ **Не работать на двух машинах одновременно** — разъедется история git.
Закончили здесь, отправили, продолжили там.

⚠️ **Любой push в `main` уходит на боевой сервер** — автодеплой, около трёх
минут. Хотите без выкатки — работайте в отдельной ветке.

## Что где собирается

| Задача | Машина |
|---|---|
| Сервер, веб, Android | любая |
| iOS (Xcode) | только MacBook: нужен macOS 26+ |
