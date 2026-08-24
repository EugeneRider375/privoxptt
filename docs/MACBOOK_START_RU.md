# MacBook: с чего начать

Инструкция для машины, на которой делается iOS. Всё, что можно было сделать без
Xcode, уже сделано на iMac — здесь только то, чего там сделать нельзя.

**Ключевая фраза для начала работы:**

> Читай docs/MACBOOK_START_RU.md и продолжаем iOS

---

## 1. Забрать свежий код

    cd ~/Projects/PrivoxPTT      # если папки нет — см. docs/WORKSTATION_SETUP.md, раздел 2
    git pull

Если не помните, куда клонировали в прошлый раз:

    find ~ -maxdepth 4 -type d -name PrivoxPTT 2>/dev/null

**Не клонировать второй раз** — получите две копии и перепутаете, в какой работали.

## 2. Проверить, что ключ APNs доехал

Рабочий стол синхронизируется через iCloud, поэтому ключ должен появиться сам:

    ls -la ~/Desktop/AuthKey_723D52BFNL.p8

Файл может быть «в облаке» и не скачан — тогда откройте его один раз в Finder,
iCloud подтянет. Размер должен быть **257 байт**.

Положите рабочую копию рядом с android-ключом:

    mkdir -p ~/PrivoxKeys && cp -n ~/Desktop/AuthKey_723D52BFNL.p8 ~/PrivoxKeys/

## 3. Настройки сервера — но сперва поймите, ГДЕ они нужны

⚠️ **Push на iPhone отправляет БОЕВОЙ сервер, а не MacBook.** Приложение на
телефоне ходит на `https://ptt.privox.tech` (`server.url` в
`capacitor.config.json`), значит и звонок ему шлёт прод. Поэтому настройки APNs
обязательны **в Coolify**, а не здесь.

Готовые значения для вставки лежат в `~/PrivoxKeys/apns-coolify-env.txt`
(файл секретный, в git его нет). Coolify → проект PrivoxPTT → Environment →
добавить пять переменных → передеплоить:

    APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_ENV, APNS_KEY

Ключ передаётся **содержимым**, а не путём к файлу: в контейнере файлов нет,
секреты приходят переменными — так же, как `FIREBASE_SERVICE_ACCOUNT_JSON`.

**На MacBook `server/.env` нужен только если поднимаете локальный сервер** для
опытов. Для обычной работы с Xcode он не требуется. Если всё же нужен:

    cat >> ~/Projects/PrivoxPTT/server/.env <<'CONF'

    # ─── APNs (iOS push) ───
    APNS_KEY_PATH=/Users/<ВАШ_ПОЛЬЗОВАТЕЛЬ>/PrivoxKeys/AuthKey_723D52BFNL.p8
    APNS_KEY_ID=723D52BFNL
    APNS_TEAM_ID=2ND5G88WGD
    APNS_BUNDLE_ID=tech.privox.ptt
    APNS_ENV=sandbox
    CONF

**Путь абсолютный**, `~` в нём не раскрывается. Если на MacBook другое имя
пользователя — поправить.

Остальные секреты (`web/.env`, `keystore.properties`, `google-services.json`,
`local.properties`, `docs/SECRETS.local.md`, `PRODUCTION.md`) — полный список в
разделе 3 `docs/WORKSTATION_SETUP.md`. Для iOS они не нужны, но если собираетесь
делать здесь что-то ещё, перенесите заодно.

## 4. Убедиться, что серверная часть жива на этой машине

    cd ~/Projects/PrivoxPTT/server
    npm ci && npx prisma generate
    npm test                      # должно быть 78 тестов, все зелёные
    node --require ts-node/register -e "
    const { sendApns } = require('./src/services/apns.ts');
    sendApns('a'.repeat(64), { probe: 1 }, { pushType: 'voip' }).then(r => console.log(r));
    "

Ожидаемый ответ — **`BadDeviceToken`**. Он означает, что Apple приняла
соединение, подпись и тему, а отвергла только выдуманный токен устройства. Это и
есть подтверждение, что ключ и настройки на месте.

Другие ответы:
- `InvalidProviderToken` → неверны ключ, `APNS_KEY_ID` или `APNS_TEAM_ID`
- `ApnsNotConfigured` → сервер не увидел настройки, проверьте путь к `.p8`

## 5. Xcode

    open ~/Projects/PrivoxPTT/ios/phone/App/App.xcodeproj

- **Settings → Accounts** — войти под тем же Apple ID; команда должна
  показываться как платная, а не «Personal Team»
- **Signing & Capabilities** — выбрать платную команду

Дальше — **`docs/IOS_CALLKIT_RU.md`**: там состояние серверной части, порядок
работ по нативной (PushKit + CallKit), настройки Universal Links и обе известные
ловушки (обязательный отчёт в CallKit на каждый VoIP-push и путаница
sandbox/production).

## Чего здесь не делать

- **Не пушить без спроса** — `push` в `main` сразу выкатывает прод.
- **Не работать одновременно с iMac** — разъедется история git.
- **Не начинать фазу 2** (нативный звук, PushToTalk Framework, 3–5 недель), пока
  не поставлен решающий опыт из `IOS_CALLKIT_RU.md`: живёт ли разговор после
  сворачивания приложения. От него объём работы отличается в разы.
