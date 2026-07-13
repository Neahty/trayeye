# 🥗 Bytwise — AI-счётчик калорий (Telegram Mini App)

Пользователь **фотографирует еду или описывает её текстом** — AI (OpenAI Vision) распознаёт блюдо и
считает калории и БЖУ. Есть дневник, история, статистика, достижения, подписки (ЮKassa), кабинет
тренера и веб-админка.

- 🌐 Прод: **`shekspireteam.ru`** (Windows VPS → `163.5.16.34`)
- 🤖 Бот: **@Bytwise_bot**
- 📜 История изменений: **[CHANGELOG.md](CHANGELOG.md)**

---

> ## 🔧 Памятка для ассистента (Claude)
>
> **Этот README — источник правды по структуре проекта, окружению, API и деплою.** При изменении кода
> обновляй соответствующий раздел здесь же, в той же задаче — это экономит время на следующих сессиях.
>
> - Изменил структуру/`process.env.*`/роуты/cron/деплой → поправь нужный раздел README.
> - Сделал значимую правку → добавь техническую запись в **[CHANGELOG-DEV.md](CHANGELOG-DEV.md)** с номером
>   «**Поправка №N**» (нумерация сквозная, бери следующий номер). Номера живут только здесь.
> - Если правка ВИДНА ПОЛЬЗОВАТЕЛЮ → отрази её и в публичном **[CHANGELOG.md](CHANGELOG.md)** (посты по
>   датам, простыми словами, БЕЗ админки/сервера/нумерации). Чисто внутренние правки туда не попадают.
> - Если правка ломает то, что описано здесь — почини описание, не оставляй устаревшим.

---

## Оглавление

1. [Технологии](#технологии)
2. [Структура репозитория](#структура-репозитория)
3. [Переменные окружения](#переменные-окружения)
4. [База данных](#база-данных)
5. [Локальный запуск](#локальный-запуск)
6. [Тесты](#тесты)
7. [API](#api)
8. [Распознавание еды (AI)](#распознавание-еды-ai)
9. [Фоновые задачи](#фоновые-задачи-cron)
10. [Подписки и оплата](#подписки-и-оплата)
11. [Тренер и его клиенты](#тренер-и-его-клиенты)
12. [Сотрудники-пиарщики](#сотрудники-пиарщики-работники)
13. [Бот техподдержки](#бот-техподдержки-support)
14. [Часовые пояса](#часовые-пояса)
15. [Деплой на VPS](#деплой-на-vps)

---

## Технологии

| Слой     | Технологии                                                       |
| -------- | --------------------------------------------------------------- |
| Mini App | React 18, Vite 5, `@twa-dev/sdk`, React Router                   |
| Админка  | React 18, Vite 5, React Router (`basename="/admin"`)            |
| Бэкенд   | Node.js, Express, `pg` (PostgreSQL), Multer, node-cron, Telegraf |
| AI       | OpenAI API: Vision `gpt-4.1` (фото) + текст `gpt-4.1-mini`       |
| Платежи  | ЮKassa (live) / mock-режим (без ключей)                         |
| БД       | PostgreSQL 16 — **нативно** (Windows-служба, без Docker)        |
| Прокси   | Caddy (TLS + reverse proxy + раздача статики)                  |
| Тесты    | Jest + Supertest (сервер), Vitest + RTL (клиент)              |

---

## Структура репозитория

```
AI каллории/
├── client/                  # Telegram mini-app (React + Vite)
│   └── src/
│       ├── pages/           # Home, History, Stats, Profile, Paywall, Onboarding, Trainer, BecomeTrainer
│       ├── components/      # PhotoSlot, TabBar, CalorieRing, NavBar, NumberPicker, icons…
│       ├── ui/              # UIProvider (sheets/toasts), mealDetail, meal (группировка приёмов), addByText
│       ├── lib/             # theme, image (даунскейл фото), sub, timezones, useCountUp
│       ├── api/index.js     # axios-клиент, login(), эндпоинты, assetUrl()
│       └── App.jsx          # boot: login → гейт канала → онбординг → роуты
├── admin/                   # Веб-админка (React + Vite), вход логин/пароль + 2FA
│   └── src/pages/           # Login, Dashboard, Users, Employees, EmployeeCard, Subscriptions, Finance, AIAnalytics, Scans, Notifications, Support, SupportTicket, Funnel, Logs, Settings
├── server/                  # Express REST API
│   └── src/
│       ├── routes/          # auth, scan, history, stats, profile, membership, subscription,
│       │                    #   trainer, myTrainer, achievements, settingsPublic, track, health, adminAuth, admin, adminEmployees
│       ├── middleware/      # auth, adminAuth, checkAdmin, checkLimit, checkTrainer, rateLimit
│       ├── services/        # openai, telegram, bot (Telegraf), yukassa, notify, channelLog, channelMembership, employeeReferrals, broadcast, cost, aiUsage, achievements, fx, openaiCosts
│       ├── jobs/            # notifications.js (cron), subscriptionReminders.js (напоминания о подписке), employeeReferrals.js (проверка рефералов сотрудников), backup.js (бэкап БД в Telegram)
│       ├── utils/           # calories, jwt, subscription, settings, tz, refcode, nutrition, http (parseId)
│       ├── db/              # index.js (pool + withTx), schema.sql, migrate.js
│       ├── app.js           # Express app (helmet, cors, статика /uploads и /api/uploads, роуты)
│       └── index.js         # entry: init БД → launchBot → cron → listen
├── support/                 # ОТДЕЛЬНЫЙ бот техподдержки (@BytwiseSupport_bot, Telegraf), общая БД
│   ├── .env                 # SUPPORT_BOT_TOKEN, DATABASE_URL, SUPPORT_ADMIN_IDS (в .gitignore)
│   └── src/                 # index.js (entry), config, db, bot, cards, schema.sql, handlers/{user,admin}
├── caddy/Caddyfile          # TLS + проксирование /api, /uploads; раздача client/admin dist
├── .env                     # СЕРВЕРНЫЙ env (в корне), читается сервером (в .gitignore)
├── start.bat                # ЕДИНЫЙ лаунчер: Postgres → deps → migrate → build → server → caddy
├── stop.bat                 # останавливает API и Caddy
├── support-start.bat        # запуск бота техподдержки (отдельно от основного приложения)
├── support-stop.bat         # остановка бота техподдержки (основное приложение не трогает)
├── restore.bat              # восстановление БД из присланного в Telegram .sql.gz
└── uploads/                 # загруженные фото (создаётся автоматически)
```

> ℹ️ Старая пользовательская реферальная система удалена (legacy-таблицы `referrals`/`referral_balance`
> не используются). Тренеры привязывают клиентов по ссылке-приглашению через `users.ref_code`
> (см. [Тренер и его клиенты](#тренер-и-его-клиенты)). Отдельно существует система
> **сотрудников-пиарщиков** с собственными таблицами `employee_*`
> (см. [Сотрудники-пиарщики](#сотрудники-пиарщики-работники)).

---

## Переменные окружения

Серверный `.env` лежит в **корне** проекта. Фронтенды читают свой `.env` из `client/` и `admin/`
(там только `VITE_API_URL`). Шаблон — `server/.env.example`.

| Переменная | Назначение |
| --- | --- |
| `DATABASE_URL` | строка подключения Postgres (`postgresql://calorie:calorie@localhost:5432/calorieyka`) |
| `DB_POOL_MAX` | размер пула соединений (по умолчанию 20) |
| `JWT_SECRET` | секрет JWT пользователей (**обязателен в production**) |
| `INITDATA_MAX_AGE_SEC` | макс. возраст Telegram `initData` (защита от replay). Дефолт в коде — сутки, в `.env` задано `3600` (1 час); на VPS должно стоять то же значение |
| `OPENAI_API_KEY` | доступ к OpenAI |
| `OPENAI_VISION_MODEL` / `OPENAI_TEXT_MODEL` | модели для фото (`gpt-4.1`) и текста (`gpt-4.1-mini`) |
| `OPENAI_ADMIN_KEY` | `sk-admin-…` — реальные расходы (Costs API) в админке; пусто → оценка по токенам |
| `USD_RUB_FALLBACK` | запасной курс $, если ЦБ РФ недоступен (по умолчанию 100) |
| `YUKASSA_SHOP_ID`, `YUKASSA_SECRET_KEY` | ключи ЮKassa; **пусто → mock-режим** |
| `PAYMENTS_MODE` | `live` — боевая оплата; `mock` — имитация (подписка активируется сразу) |
| `YUKASSA_RECURRING` | `true` → запрашивать `save_payment_method` (автопродление). По умолчанию выключено |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | бот |
| `SUPPORT_BOT_TOKEN` | токен бота техподдержки (тот же, что в `support/.env`) — нужен серверу для ответов из веб-админки и показа фото из тикетов |
| `REQUIRED_CHANNEL_ID`, `REQUIRED_CHANNEL_URL` | обязательная подписка на канал (бот должен быть **админом** канала). Пусто → проверка отключена |
| `ADMIN_TELEGRAM_IDS` | telegram_id админов через запятую |
| `ADMIN_JWT_SECRET` | секрет JWT админки (**обязателен в production**) |
| `ADMIN_BOOTSTRAP_PASSWORD` | стартовый пароль админки (ставится при `migrate`); сменить после входа |
| `ADMIN_IP_ALLOWLIST`, `ADMIN_MAX_ATTEMPTS`, `ADMIN_LOCK_MINUTES` | защита админки |
| `SERVER_URL`, `CLIENT_URL` | публичные URL бэкенда и mini-app (`https://shekspireteam.ru`) |
| `CORS_ORIGIN` | разрешённые источники (в проде — только `https://shekspireteam.ru`) |
| `PORT`, `NODE_ENV` | порт API (4000), окружение (`production`) |
| `SUB_PRICE_BASIC`, `SUB_PRICE_TRAINER` | fallback-цены тарифов (основное — в `app_settings`) |
| `TRIAL_DAYS`, `TRIAL_DAILY_PHOTOS`, `TRAINER_MAX_CLIENTS` | триал и лимиты (fallback) |

`client/.env` и `admin/.env`: `VITE_API_URL` = `https://shekspireteam.ru` (прод) / `http://localhost:4000` (локально).

---

## База данных

PostgreSQL 16 ставится **нативно** и работает как Windows-служба (Docker не используется).

**Разовая настройка:**
1. Установить **PostgreSQL 16** (EDB installer для Windows), запомнить пароль суперпользователя `postgres`.
2. Запустить **`start.bat`** — он сам создаст роль `calorie`/`calorie` и БД `calorieyka` (при первом
   запуске спросит пароль `postgres`), применит схему (`migrate`) и поднимет всё.

Схема и миграции — `server/src/db/schema.sql` (идемпотентна: `CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, дедуп перед UNIQUE-индексами). Транзакции — через `db.withTx()`.

**Регистрация пользователя.** Запись в `users` создаётся в двух точках:
- `/start` в боте (`bot.js` → `registerStartUser`) — заводит со `app_opened=FALSE`;
- первый вход в мини-приложение (`auth.js`) — создаёт или обновляет запись и ставит `app_opened=TRUE`.

Колонка `users.app_opened` отличает тех, кто только нажал `/start`, от реально зашедших.
В админке («Пользователи») первые показаны в колонке «Подписка» как «не открыл приложение».

При появлении **нового** пользователя (в любой из двух точек) всем админам из
`ADMIN_TELEGRAM_IDS` уходит Telegram-уведомление — `notify.notifyNewUser()`. Срабатывает
только на новой записи (`(xmax = 0) AS inserted`), повторный `/start` не дублирует.

---

## Локальный запуск

```bash
# 1) Поднять нативный PostgreSQL (служба) — см. раздел выше
cd server && npm install && npm run migrate && npm run dev   # API на :4000
cd client && npm install && npm run dev                      # mini-app на :5173
cd admin  && npm install && npm run dev                      # админка на :5174
```

Вне Telegram авторизация работает через dev-байпас: открой `http://localhost:5173/?dev_id=123`
(работает только при `NODE_ENV != production`).

---

## Тесты

```bash
cd server && npm test     # Jest + Supertest (БД не требуется)
cd client && npm test     # Vitest + RTL
```

---

## API

Базовый префикс `/api`. Пользовательские роуты защищены `auth` (Bearer JWT), админские — `adminAuth`.

| Метод | Путь | Описание |
| --- | --- | --- |
| POST | `/api/auth/telegram` | вход по `initData` (или `dev_id` вне прода) → JWT |
| POST | `/api/scan` | фото-скан (multipart `image`) → распознавание, лимит/триал |
| POST | `/api/scan/text` · `/manual` | добавление текстом / вручную |
| GET | `/api/scan/suggestions` | подсказки-чипы для ввода текстом: `recent` (последние уникальные блюда юзера) + `popular` (глобальный топ, кэш 1 ч, фолбэк-список) |
| PATCH·DELETE | `/api/scan/:id` | редактирование / удаление записи |
| GET | `/api/history?date=YYYY-MM-DD` | дневник за день (в tz пользователя) |
| GET | `/api/stats?period=day\|week\|month\|year` | статистика, БЖУ, streak, цели |
| GET·PATCH | `/api/profile` | профиль; POST `/api/profile/avatar` — аватар; `PATCH /api/profile/goals` — задать норму КБЖУ вручную (`goals_set_manually=TRUE`); `POST /api/profile/goals/auto` — вернуть авто-расчёт. `GET` отдаёт `subscription`, `last_subscription` (последняя любого статуса — для текста пейволла), `trial`, `trainer`, `has_access` |
| GET | `/api/membership?force=1` | подписан ли на обязательный канал |
| POST | `/api/subscription/buy` | покупка (`type` = id тарифа; `409 already_subscribed` если активна) |
| GET·POST | `/api/subscription/status` · `/payments` · `/cancel` · `/webhook` | подписка (`status`; `payments` — история платежей пользователя для экрана «Управление подпиской»; `cancel`; `webhook` ЮKassa) |
| GET | `/api/achievements` · `/api/settings/public` | прочее |
| * | `/api/trainer/*` | кабинет тренера (нужна активная подписка `trainer`): `GET /invite`, `clients`, `clients/:id/history\|stats\|weight`, **`DELETE clients/:id`** (отвязать клиента), `PATCH clients/:id/goals`, `POST scans/:id/comment` |
| * | `/api/my-trainer` | связь клиента с тренером: `GET`, `POST /accept {code,replace}`, `DELETE` |
| POST·GET | `/api/admin/auth/login` · `/me` … | вход в админку (логин/пароль + 2FA) |
| GET | `/api/admin/dashboard`, `/users`, `/finance`, `/finance/yukassa`, … | данные админки |
| * | `/api/admin/employees/*` | раздел «Работники»: `GET /` (список с агрегатами), `POST /` `{query}` (добавить по telegram_id/@username; 404 `user_not_found` если не нажимал /start), `DELETE /:id` (деактивация, история остаётся), `GET /:id` (карточка: статистика, рефералы поимённо, график 30 дн, выплаты), `POST /:id/payouts {kind, rate}` (отметить выплату), `POST /:id/payouts/:payoutId/cancel` (отменить) |
| * | `/api/admin/support/*` | тикеты поддержки: `GET /tickets?status=`, `GET /tickets/:id`, `POST /tickets/:id/reply\|close`, `GET /photo/:fileId` (прокси фото из Telegram) |
| static | `/uploads/*`, `/api/uploads/*` | загруженные фото |

---

## Расчёт дневной нормы (КБЖУ)

Логика в `server/src/utils/calories.js` (`calcDailyNorms`), пересчёт — в `PATCH /api/profile`
(только если норма не задана тренером или вручную: `!goals_set_by_trainer && !goals_set_manually`).

- **Формула — Миффлин-Сан Жеор, от ЦЕЛЕВОГО веса** (метод целевого веса): BMR считается по
  `target_weight` (fallback на текущий `weight` для старых профилей). Поэтому смена желаемого веса
  сразу меняет норму: меньше цель → меньше калорий.
- **Активность — из числа тренировок в неделю** (`workouts_per_week` — единый источник правды),
  5-уровневая шкала: `sedentary 1.2` (0 трен) / `light 1.375` (1–2) / `moderate 1.55` (3–4) /
  `high 1.725` (5–6) / `very_high 1.9` (7+). Поле `users.activity` — производный label для отображения.
- **Направление цели — автоматически** (`deriveGoal`) по разнице текущего и целевого веса
  (`loss` / `gain` / `maintain`, допуск ~1 кг); дельта `−300 / +300 / 0` ккал. Защитный минимум нормы —
  1500 ккал (муж.) / 1200 (жен.).
- **БЖУ** распределяются 30 % белки / 30 % жиры / 40 % углеводы.
- **Ручной ввод.** Пользователь может задать свои КБЖУ (`PATCH /api/profile/goals`, флаг
  `goals_set_manually`) — тогда авто-пересчёт их не трогает; «Вернуть автоматический расчёт»
  (`POST /api/profile/goals/auto`) снимает флаг и пересчитывает. У клиента тренера норму задаёт тренер.
- `maintenanceTdee` в `stats.js` (график «Баланс калорий») использует ту же шкалу активности, но от
  ТЕКУЩЕГО веса — это фактический расход сейчас, без дельты цели.

---

## Распознавание еды (AI)

Логика в `server/src/services/openai.js`. Фото распознаёт `gpt-4.1` (Vision), текст — `gpt-4.1-mini`;
оба запроса идут с `temperature: 0.2` и `response_format: { type: "json_object" }` (гарантированно валидный JSON).

**Как считаются калории и БЖУ.** Модель не «угадывает» итог сразу, а рассуждает пошагово (поле `analysis`):
**точно опознаёт блюдо по реально видимым признакам** (цвет/форма/текстура/ингредиенты) — промпт запрещает
подгонять под «типичное» блюдо и требует верное обобщённое название при сомнении (с понижением `confidence`) →
честно оценивает **массу порции** (граммы, с опорой на референсы масштаба и объём/высоту) →
прикидывает реалистичную **плотность калорий (ккал/г)** → выдаёт **итог именно для этой массы** (НЕ «на 100 г»).
Промпт прямо **запрещает округлять** итог до сотен/полусотен — число должно быть точным (например 437, а не 450).
Фото перед отправкой сжимается на клиенте до 1536px по большей стороне (`client/src/lib/image.js`) — деталей хватает для распознавания.

**Упаковка / этикетка (приоритет над оценкой на глаз).** Если на фото видна упаковка с таблицей «Пищевая
ценность», промпт требует прочитать её ПОЛНОСТЬЮ (КБЖУ на 100 г или на порцию, состав, бренд/название,
«масса нетто», число порций) и пересчитать на реально съеденную массу (`итог = на_100г × масса_г ÷ 100`;
при съеденной целиком упаковке — масса нетто). В `analysis` фиксируется источник чисел — «с этикетки» или
«визуальная оценка». При текстовом вводе действует аналогичное правило: если пользователь привёл КБЖУ на 100 г
и массу, модель пересчитывает на массу, а не возвращает значения на 100 г.

В клиенте при добавлении фото показывается подсказка фотографировать упакованную еду со стороны состава/КБЖУ
(`TabBar.jsx`, `CameraButton.jsx`), а форма ввода текстом (`addByText.jsx`) предлагает чипы из `/api/scan/suggestions`
(последние блюда пользователя либо популярные) и помарочку о меньшей точности текста относительно фото.

**Подстраховки в коде** (`normalizeDish` / `reconcileMacros`):
- согласование по формуле Атуотера: `калории ≈ protein*4 + carbs*4 + fat*9`; при расхождении > 20 %
  калории пересчитываются из макросов, а `confidence` понижается;
- если итог даёт > 9 ккал/г (физически невозможно — чистый жир = 9 ккал/г), `confidence` ставится `low`;
- калории хранятся целым числом, БЖУ — до 0.1 г.

Наружу (`/api/scan`, `/api/scan/text`) каждое блюдо отдаётся полями
`dish_name, calories, protein, fat, carbs, weight_grams, confidence`.

---

## Фоновые задачи (cron, `server/src/jobs/notifications.js`)

| Расписание | Задача |
| --- | --- |
| `0 * * * *` (ежечасно) | **напоминания о еде** по поясу пользователя, если за приём ещё нет записи. Часы (деф. 09/14/19), вкл/выкл и тексты — в настройке `meal_reminders` (правится в админке «Настройки → Напоминания → Напоминания о еде»), дефолты в `utils/settings.js`. Карта `час → [приёмы]` — массив: если двум приёмам задан один час, уходят оба напоминания (Поправка №42). **По 50 вариантов на приём** (breakfast/lunch/dinner), выбор детерминированный `(user_id+день месяца) % N` (переиспользуются `renderTemplate`/`pickTemplate`/`loadPersonalStats` из `subscriptionReminders._internal`). Плейсхолдеры `{name} {daily_calories} {calories_today} {calories_left} {streak} {days_tracked} {meals_count} {weight_delta}`; шаблон без данных пропускается (поэтому есть и тексты без подстановок — новичку всегда что-то уйдёт). Фильтры: `notifications_enabled AND NOT is_blocked AND NOT tg_unreachable AND app_opened`. При 403 → `channelMembership.markUnreachable` (ставит `tg_unreachable`, лог `blocked_bot`). Кнопка **«Проверить на себе»** (`POST /admin/reminders/meal-test { meal }` → `sendTestMealReminder`) |
| `10 * * * *` (ежечасно) | **детектор окончания подписок** (`subscriptionExpiryCheck`): подписки с `expires_at` в окне последних 2 суток, `expiry_logged_at IS NULL` и без более поздней активной → лог `subscription_expired`; отметка `expiry_logged_at` до лога (дедуп) |
| `5 * * * *` (ежечасно) | **напоминания о подписке/триале** (`jobs/subscriptionReminders.js`): шлёт тем, у кого локально «час отправки» из настройки `reminders`. Платная подписка — за `paid_pre_days` (деф. 7/3/1) дней до конца; триал — в первый и последний день; после окончания (обоих) — серия `post_days` (деф. 0/1/3/7/14 дней) и стоп. Тексты (10–12 вариантов на контекст) с плейсхолдерами `{name} {meals_count} {days_tracked} {weight_delta} {days_left} {expires_date} {trial_days}`; шаблон без данных пропускается, выбор детерминированный `(user_id+стадия) % N`. Кнопка «Продлить» → `t.me/<bot>?startapp=paywall`. Дедуп — таблица `subscription_reminders` (`UNIQUE user_id+kind+stage+anchor_at`, вставка ДО отправки; новый `expires_at` = новая серия). **`notifications_enabled` игнорируется** (бизнес-критично), уважаются `is_blocked`/`tg_unreachable`/`app_opened`, клиенты активного тренера пропускаются. Всё настраивается в админке («Настройки → Напоминания»). Кнопка **«Разослать сейчас»** (`POST /admin/reminders/run` → `subscriptionReminders({ force: true, blast: true })`) — режим blast: каждому уходит сообщение по его ТЕКУЩЕЙ ситуации (`classifyBlast`: пробный идёт/последний день/кончился, подписка истекает ≤ max(paid_pre_days)/истекла — сколько бы дней ни прошло), дедуп `manual_<тип>` + дата. Общий предохранитель в обоих режимах: не больше одного напоминания в сутки на человека (`reminded_recently`, окно 20 часов). Кнопка **«Проверить на себе»** (`POST /admin/reminders/test { kind }` → `sendTestReminder`) — пример с префиксом 🧪 только текущему админу, недостающие цифры — образцы. Env: `REMINDER_FORCE=1` — прогон планового режима без фильтра по часу |
| `20 * * * *` (ежечасно) | **сотрудники-пиарщики** (`jobs/employeeReferrals.js`): pending-рефералы старше 24 ч → `confirmed` (открыл приложение + в канале + не заблокировал бота) или `rejected` с причиной; плюс страховочная атрибуция оплат рефералов за 2 дня (`attributePaymentsSince`) |
| `0 3 * * *` | удаление фото старше 12 месяцев |
| `0 21 * * *` (МСК) | **ежедневная сводка** в канал логов (`dailyDigest`): за сутки — новые подписчики/вышли из канала/активные/сканы/оплаты(кол-во+сумма)/истёкшие подписки + всего подписчиков канала. Тип события `daily_digest` |
| `0 0 * * *` (МСК) | авто-бэкап БД: `pg_dump` → gzip → отправка `.sql.gz` всем `ADMIN_TELEGRAM_IDS` (`jobs/backup.js`). Путь к pg_dump — env `PG_DUMP`. Восстановление — `restore.bat` |

---

## Подписки и оплата

- **Mock-режим** (нет ключей ЮKassa или `PAYMENTS_MODE=mock`): `POST /api/subscription/buy` сразу создаёт
  активную подписку и возвращает `{ activated: true }` — клиент перезагружает профиль без редиректа.
- **Live ЮKassa:** `buy` возвращает `payment_url`; после оплаты ЮKassa шлёт `POST /api/subscription/webhook`.
  Вебхук **перепроверяет платёж** через `getPayment()` и вызывает `fulfillPayment` (создаёт подписку).
  Обрабатываются `payment.succeeded` / `payment.canceled` / `refund.succeeded`; вебхук всегда отвечает `200`.
- **Идемпотентность и атомарность.** `fulfillPayment` (`routes/subscription.js`) выполняется в одной
  транзакции (`db.withTx`); повтор/гонка вебхука не создаёт дублей — частичный `UNIQUE` на
  `payments(yukassa_id) WHERE succeeded` (ловит `23505`). Новая выдача гасит прежние active-подписки.
- Активность подписки = `subscriptions.status='active' AND expires_at > NOW()` (`utils/subscription.js`).
- **Нельзя купить повторно при активной подписке** (`409 already_subscribed`), **кроме апгрейда
  basic → trainer**: разрешён за полную цену, `fulfillPayment` гасит basic и запускает тренерскую
  с нуля на её срок. Даунгрейд trainer → basic и повтор того же тарифа — по-прежнему 409.
  Ручная выдача из админки — единый роут `PATCH /users/:id/subscription` (тип PRO/Тренерская + срок
  30/90/180/365 дней выбираются в карточке пользователя; отдельный `/trainer` удалён) — без этой проверки;
  по умолчанию не пишет в выручку, при `record_payment:true` создаёт `payments(method='manual')`.
- **Тарифы редактируются из админки** («Настройки → Тарифы и цены», `app_settings.tariffs` —
  единственный источник правды). `GET /api/settings/public` отдаёт только включённые тарифы; Paywall
  показывает **все включённые тарифы, включая тренерский**. Тариф `basic` в UI отображается как **«Pro»**.
- **Настройки в админке разбиты на вкладки**: «Тарифы и цены», «Пробный период и лимиты»,
  «Тексты приложения», «Напоминания» (две части: **подписка/триал** — действия «Разослать сейчас»/
  «Проверить на себе» + расписание/час/кнопка/тексты, ключ `app_settings.reminders`; и **напоминания о
  еде** — вкл/выкл, часы завтрака/обеда/ужина, по 50 текстов на приём + «Проверить на себе», ключ
  `app_settings.meal_reminders`; дефолты в `utils/settings.js DEFAULTS`), «Безопасность».
  Форма общая — переключение вкладок не теряет правки, «Сохранить» пишет всё разом. В списке пользователей
  админки у каждого видно, когда кончается подписка («до …») или пробник («пробник до … / истёк …»,
  поля `sub_expires_at`/`trial_ends_at`/`last_sub_expires_at`).
- **Deep link на оплату:** `t.me/<bot>?startapp=paywall` открывает мини-апп сразу на `/paywall`
  (обработка `start_param` в `client/src/App.jsx`) — используется кнопкой «Продлить» в напоминаниях.
  Если доступ уже есть (своя подписка или доступ от тренера) — ведёт в «Управление подпиской», а не на пейволл.
- **Пейволл показывается только без доступа.** `Paywall.jsx` при наличии `profile.subscription`/`profile.trainer`
  редиректит в `/subscription`. Подзаголовок зависит от ситуации: была платная подписка и истекла
  (`profile.last_subscription` от `/api/profile`) → «Подписка закончилась»; пробный истёк → «Пробный период
  закончился»; пробный ещё идёт → нейтральный `paywall_text` из настроек.

---

## Тренер и его клиенты

- **Роль тренера = активная подписка `type='trainer'`** (`isTrainer` в `utils/subscription.js`).
  Покупается кнопкой «Стать тренером» в Профиле (`BecomeTrainer.jsx`) **или прямо на Paywall**
  (тренерский тариф показывается вместе с PRO; с активной basic доступен апгрейд).
- **Привязка клиента — по ссылке.** Тренер берёт `GET /api/trainer/invite` →
  `https://t.me/<bot>?startapp=tr_<ref_code>`. Клиент открывает мини-апп, видит подтверждение и
  `POST /api/my-trainer/accept`. Один клиент — один тренер (`UNIQUE` по `client_id`). Лимит —
  настройка `trainer_max_clients`.
- **Доступ от тренера.** `hasEffectiveAccess` = своя активная подписка ИЛИ клиент тренера с активной
  trainer-подпиской. Пока подписка тренера активна, клиенты работают без лимита.
- **Кабинет тренера** (`client/src/pages/Trainer.jsx`): список клиентов, у каждого — **кнопка-корзина
  для отвязки** (с подтверждением). По клиенту — цели КБЖУ, дневник за дату (фото + комментарии),
  графики калорий и веса. Данные клиента считаются в **его** часовом поясе.
- **Отвязка** (клиент сам — `DELETE /api/my-trainer`; тренер — `DELETE /api/trainer/clients/:id`; смена
  тренера) сбрасывает `users.goals_set_by_trainer=FALSE` — клиент снова правит цели сам.

---

## Сотрудники-пиарщики («Работники»)

Наёмные пиарщики приводят людей по персональным ссылкам; владелец видит их работу в админке и
отмечает выплаты. Вся бизнес-логика — `server/src/services/employeeReferrals.js`.

**Роль и команды.** Сотрудника добавляет админ (админка → «Работники») по Telegram ID или
@username — человек должен уже нажимать `/start` в боте (иначе 404 с подсказкой). После добавления
бот присылает ему приветствие. Команды **только для активных сотрудников** (всем остальным бот
молчит, фича не светится):
- `/ref` — персональная ссылка `t.me/<бот>?start=emp_<code>` + правила зачёта;
- `/stat` — переходы/рефералы/оплаты за день·7·30 дней (МСК) + сколько выплачено и сколько ждёт.

**Правила зачёта реферала:**
- переход фиксируется всегда (`employee_link_clicks`), но рефералом становится только **новый**
  пользователь (признак `inserted` из `registerStartUser`); сам сотрудник и другие сотрудники — нет;
- реферал создаётся со статусом `pending`; через 24 ч крон (`jobs/employeeReferrals.js`, `20 * * * *`)
  подтверждает (`confirmed`), если человек **открыл приложение + состоит в канале + не заблокировал
  бота** (`app_opened AND channel_member AND NOT tg_unreachable`), иначе `rejected` с причиной;
- ссылка уволенного сотрудника (active=FALSE) новых рефералов не привязывает.

**Оплаты рефералов.** Каждая успешная оплата реферала (включая продления, бессрочно) засчитывается
сотруднику — `attributePaymentsSince`: идемпотентный INSERT из `payments` (UNIQUE по `payment_id`),
вызывается после `fulfillPayment` и ежечасно из крона (страховка + ручные начисления админом).
Оплаты рефералов со статусом `rejected` не засчитываются.

**Выплаты (вручную, вне системы — тут только учёт).** В карточке сотрудника: «Выплатить» → тип
(за приведённых людей / за оплаченные подписки) → админка показывает сколько не выплачено → ввод
ставки ₽ за единицу → выплата закрывает **всё** невыплаченное типа (`payout_id` на строках), сумма =
кол-во × ставка. Отмена выплаты возвращает единицы в «невыплаченные». Сотрудник получает ЛС о
выплате/отмене.

**Уведомления.** Сотруднику в ЛС (без имён рефералов — только цифры): роль выдана, новый реферал
(«на проверке»), реферал оплатил, выплата/отмена. Всё дублируется в канал логов (тумблер `employees`
в «Настройки → Логи в Telegram») — там имена видны.

**БД** (`schema.sql`, блок «Сотрудники-пиарщики»): `employees` (user_id UNIQUE, code UNIQUE, active),
`employee_link_clicks`, `employee_referrals` (user_id UNIQUE — один юзер = один сотрудник; status
pending/confirmed/rejected; payout_id NULL = не выплачено), `employee_payments` (payment_id UNIQUE),
`employee_payouts` (kind, unit_count, unit_rate, total, status paid/cancelled). Повторное добавление
уволенного (`ON CONFLICT DO UPDATE active=TRUE`) сохраняет код и историю. Статистика считается по
**Москве** (`Europe/Moscow`).

---

## Бот техподдержки (support/)

Отдельное Node.js-приложение (**@BytwiseSupport_bot**, Telegraf + pg) в папке `support/`.
Запускается и останавливается **независимо** от основного приложения (`support-start.bat` /
`support-stop.bat`), но подключается к **общей БД** `calorieyka`.

**Как работает:**
- Пользователь пишет боту проблему (текст и/или фото). Если открытого тикета нет — создаётся новый
  (`support_tickets`), иначе сообщение добавляется к существующему (`support_messages`). Диалог
  полноценный: переписка туда-сюда, пока админ не закроет тикет.
- Все админы из `SUPPORT_ADMIN_IDS` получают карточку: имя/username, данные из общей таблицы `users`
  (имя в приложении, дата регистрации, открывал ли приложение) и кнопки **«✍️ Ответить» / «✅ Закрыть»**.
- «Ответить» → бот ждёт текст/фото от админа (in-memory `pending`, `/cancel` — отмена) и доставляет
  пользователю с префиксом «💬 Ответ поддержки». «Закрыть» → атомарный UPDATE, пользователь уведомлён.
  Остальные админы получают пометку «Тикет №N: ответил/закрыл X».
- Меню админа — по `/start`, кнопка «📂 Открытые тикеты» (управление кнопками, без команд).

**Хранение:** таблицы `support_tickets` (id, **ticket_no** — публичный случайный 6-значный номер,
user_id = telegram_id, username, статус open/closed, тема, даты) и `support_messages` (ticket_id,
sender user/admin, via bot/web, text, photo_file_id). Пользователю и в админке показывается `ticket_no`
(«Обращение №482917»), а не порядковый `id` — чтобы не выдавать общее число обращений. Номер
генерируется при создании тикета (`support/src/handlers/user.js`, повтор при коллизии по
`uniq_support_ticket_no`), старые тикеты бэкфилятся в схеме разбросом `id*73 mod 900000`.
DDL живёт в двух местах: `server/src/db/schema.sql` (источник правды) и копия `support/src/schema.sql`
(бот применяет её сам на старте) — **при изменении править оба файла**. Один открытый тикет на
пользователя гарантирует частичный UNIQUE-индекс `uniq_support_open_per_user`.

**Дублирование в Telegram-канал:** новые обращения и сообщения поддержки бот может дублировать в общий
канал логов (`support/src/channelLog.js`). Канал админит ОСНОВНОЙ бот, поэтому процесс поддержки постит
его токеном — для этого в `support/.env` добавляется `TELEGRAM_BOT_TOKEN` (токен основного бота).
Сам канал и тумблер события `support` берутся из общей таблицы `app_settings` (управляется в админке,
«Настройки → Логи в Telegram»). Нет токена или выключено — поддержка просто не постит в канал.

**Раздел «Поддержка» в веб-админке:** список тикетов с фильтром, переписка, ответ прямо с сайта
(уходит пользователю от имени бота через `SUPPORT_BOT_TOKEN`, `server/src/services/supportBot.js`)
и закрытие. Фото из Telegram проксируются эндпоинтом `/api/admin/support/photo/:fileId`
(фронт качает blob с Bearer-токеном). Эндпоинты — в `server/src/routes/admin.js`, блок «ПОДДЕРЖКА».

**Edge-кейсы:** пользователь заблокировал бота (403) → ответ сохраняется в историю с предупреждением
админу; ответ/закрытие закрытого тикета → понятный отказ; тексты длиннее 4096 символов режутся на части;
двойное закрытие исключено атомарным `UPDATE … WHERE status='open'`.

---

## Логи в Telegram-канал и автообновление админки

**Логи в канал** (`server/src/services/channelLog.js`, для поддержки — `support/src/channelLog.js`):
основной бот дублирует события в Telegram-канал. Всё управляется из админки («Настройки → Логи в
Telegram») и хранится в `app_settings`:
- `tg_log_enabled` — мастер-выключатель;
- `tg_log_channel_id` — id канала (деф. `-1004283676399`); основной бот должен быть **админом** канала;
- `tg_log_events` — тумблеры событий: `users` (**новый = подписался на обязательный канал**),
  `channel_left` (вышел из канала), `blocked_bot` (403 — заблокировал/не начинал диалог),
  `reactivation` (вернулся после паузы ≥ 14 дней), `daily_digest` (ежедневная сводка),
  `payments` (оплаты/отмены/возвраты/ручная выдача), `payment_started` (открыл окно оплаты ЮKassa),
  `subscription_renew` (повторная оплата = продление), `subscription_expired` (подписка/триал кончились),
  `autorenew_cancel` (отключил автопродление), `scans_photo` (фото-сканы — фото + блюдо/ккал, только
  `source='photo'`), `errors` (500-ошибки из `app.js` и сбои AI в `scan.js`), `support` (обращения),
  `employees` (сотрудники-пиарщики: выдача роли, новые рефералы и итоги их проверки, оплаты рефералов, выплаты).

Хуки: `services/channelMembership.js` (новый пользователь/выход из канала/блокировка — идемпотентно,
по одному разу), `bot.js` (`/start`, `check_sub`, `bot.on("chat_member")` — нужны права админа бота в
канале + `allowedUpdates` со `chat_member`), `auth.js` (новый через приложение + `reactivation`),
`notify.js` (платежи/продления), `routes/subscription.js` (`payment_started`/`autorenew_cancel`),
`jobs/notifications.js` (`daily_digest`/`subscription_expired`), `routes/scan.js` (фото), `app.js`
(ошибки), `routes/admin.js` (ручная выдача), `support/src/handlers/user.js` (обращения). Любой сбой
отправки гасится — канал не роняет основной поток.

**Учёт членства в канале + активные/неактивные.** «Пользователь = подписчик обязательного канала,
открывавший приложение»: колонки `users.channel_member/channel_joined_at/channel_left_at`
(бэкофилл в `schema.sql` — все с `app_opened=TRUE`). Лог «Новый пользователь» уходит ровно один раз —
когда `channel_joined_at` проставляется впервые (`markChannelJoined`). Среди `app_opened=TRUE`:
**активный** = `channel_member=TRUE AND tg_unreachable=FALSE`; **неактивный** = `channel_member=FALSE
OR tg_unreachable=TRUE` (отписался/в ЧС). **Данные неактивных не удаляются** — меняется только статус.
В дашборде «Всего/Активные пользователи» = активные, отдельная карточка «Неактивные»; конверсия —
от активных. Список пользователей: фильтр `?active=true|false` + бейдж статуса. Те же определения —
в ежедневной сводке (`dailyDigest`).

**Автообновление админки** (`admin/src/lib.jsx`): `useFetch(fn, deps, { intervalMs })` тихо
перезапрашивает данные по интервалу (без мигания спиннера, пауза на скрытой вкладке). Интервал —
настройка `admin_live_refresh_sec` (деф. 10 сек, 0 — выключить); пауза/возобновление — индикатор в
боковом меню (`LiveProvider`/`useLive`). Включено на «живых» страницах: Дашборд, Пользователи,
Подписки, Деньги, Распознавание, Поддержка, История действий. Страница «История действий» показывает
события человеческим языком (маппинг `action`+`details` → фраза), а не сырой JSON.

---

## Управление подпиской (клиент)

Экран `client/src/pages/ManageSubscription.jsx` (маршрут `/subscription`, вход из Профиля → «Моя
подписка» при активной подписке, триале **или доступе от тренера**): статус с датой окончания, числом
оставшихся дней и прогресс-баром срока. Для клиента тренера (своей подписки нет, доступ от тренера)
статус — «Доступ от тренера» / «Доступ открыт тренером». Смена/улучшение тарифа (для `basic` — апгрейд
до тренерской, для триала — любой тариф; покупка через тот же `POST /subscription/buy`); история
платежей (`GET /subscription/payments`); кнопка «Написать в поддержку». Тарифы и их **порядок** задаются
в админке (Настройки → Тарифы): кнопки ↑/↓ меняют порядок показа на экране оплаты, пресеты периодов
(Месяц/3 мес/6 мес/Год) проставляют `duration_days`; подпись `period` формируется автоматически из срока
(хелпер `periodLabel`, ручное поле «Подпись периода» убрано). Тарифы и история платежей грузятся
вместе (`loadData`, `Promise.all`); при сбое сети — карточка «Не удалось загрузить…» с кнопкой
«Повторить» вместо молча пустой страницы (Поправка №42).

---

## Часовые пояса

Пояс пользователя (`users.timezone`, IANA-строка) выбирается в онбординге и в Профиле. Применяется так:

- **Время и «день» форматирует сервер** (полный ICU), а не клиент (в Telegram-webview ICU урезан):
  `GET /api/history` отдаёт `time_label`, `GET /api/profile` отдаёт `server_today`.
- Границы «дня» в истории/статистике/лимитах — через `AT TIME ZONE` (хелперы `utils/tz.js`,
  дефолт `Europe/Moscow`).
- Стрик и достижения считают «дни» в поясе пользователя.
- Напоминания о еде считают локальный час через `COALESCE(timezone,'Europe/Moscow')`.
- Время в **админке** — фиксированно `Asia/Yekaterinburg` (МСК+2), включая метрики «за сегодня».

---

## Деплой на VPS

Windows, домен `shekspireteam.ru`. Каталог проекта: `C:\Users\Admin\Desktop\Bytwise` (прописан в Caddyfile).

**Caddy** (`caddy/Caddyfile`): `/api/*` и `/uploads/*` → `reverse_proxy localhost:4000`;
`/admin/*` → `admin/dist`; остальное → `client/dist`.

**Порядок выкладки:**
1. Обновить на VPS `server/src/`, `client/dist/`, `admin/dist/`, `caddy/Caddyfile`, при необходимости `.env`
   (фронтенды собирает `start.bat`).
2. Перезапустить API (Node на :4000) — применятся код, cron и пул БД.
3. Перезагрузить Caddy: `caddy reload --config C:\Users\Admin\Desktop\Bytwise\caddy\Caddyfile`.
4. Переоткрыть mini-app в Telegram (сброс кэша webview).

> При обновлении `migrate` сам добавит колонку `support_tickets.ticket_no` и забэкфилит старые тикеты.
> Для логов в канал: основной бот должен быть **админом** канала `-1004283676399` (или другого из
> настроек). Чтобы в канал шли и события **поддержки**, в `support/.env` добавьте `TELEGRAM_BOT_TOKEN`
> (токен основного бота) и перезапустите бот поддержки.

**Батники:** `start.bat` — единый запуск (Postgres → deps → migrate → build → API + Caddy);
`stop.bat` — останавливает API и Caddy; `support-start.bat` / `support-stop.bat` — запуск/остановка
бота техподдержки (независим от основного приложения); `restore.bat` — восстановление БД из `.sql.gz`.

---

📜 Полная история правок — в **[CHANGELOG.md](CHANGELOG.md)**.
