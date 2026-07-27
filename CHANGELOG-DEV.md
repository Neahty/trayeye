# Технический журнал изменений Bytwise (для разработки)

Подробная история правок с именами файлов, функций и кодом — для разработки.
Человеческая версия тех же поправок (для пользователя) — в [CHANGELOG.md](CHANGELOG.md).
Нумерация «Поправка №N» общая для обоих файлов.

> При каждой правке запись добавляется в ОБА файла под одним номером:
> сюда — технические подробности, в `CHANGELOG.md` — простыми словами.

---

- **Поправка №47 — 2026-07-27 (Пользовательская программа «Пригласи друга»: короткая реф-ссылка, экран в профиле, раздел в админке)**:
  - **Контекст.** В канал уходит пост-конкурс «кто больше всех пригласит друзей — месяц PRO». Пользовательской рефералки не было: старая удалена Поправкой №23 (таблицы `referrals`, `referral_balance`, `users.referred_by` остались мёртвыми и не переиспользуются). Механика зачёта скопирована с сотрудников-пиарщиков (Поправка №43), но БЕЗ денег: награда выдаётся вручную из админки, таблиц выплат нет.
  - **Схема — `server/src/db/schema.sql` (конец файла).** `users.invite_code TEXT UNIQUE`; `user_invites (inviter_id, user_id UNIQUE, status pending|confirmed|rejected, reject_reason, created_at, decided_at)` + индексы `idx_user_invites`, `idx_user_invites_created`; `user_invite_clicks (inviter_id, telegram_id, existing_user, clicked_at)` + `idx_user_invite_clicks`. Отдельная колонка, а не `ref_code`: тот 8-символьный hex уже вшит в тренерские ссылки `tr_<ref_code>` и в `POST /api/trainer/clients`.
  - **Короткий код — `server/src/utils/refcode.js`.** `genInviteCode(len=5)` по алфавиту `23456789abcdefghjkmnpqrstuvwxyz` (без `0/o`, `1/l/i`), `uniqueInviteCode()` с наращиванием длины 5→6→7 при коллизиях, `ensureInviteCode(userId)` (ленивая выдача старым аккаунтам). Ссылка: `t.me/<бот>?start=rxfpj` — без префикса, в отличие от `emp_<hex>`.
  - **Сервис — `server/src/services/userInvites.js` (новый).** `buildLink`, `getByInviteCode` (регистронезависимо), `handleStartLink({code, from, userRow})` — клик пишется ВСЕГДА, приглашение только при `userRow.inserted === true && !isSelf`, вставка `ON CONFLICT (user_id) DO NOTHING`; `statsForUser(userId)` (`COUNT(*) FILTER`, периоды день/7/30 по МСК); `notifyDecided(inviterId, status, reason)`. Приглашающему в ЛС уходят только цифры, без имён приведённых; имена — в лог-канал.
  - **Бот — `server/src/services/bot.js`.** В `bot.start` payload вынесен в переменную; после ветки `emp_` добавлена `else if (user)` с регексом `/^[a-z0-9]{4,12}$/i` → `userInvites.handleStartLink` (fire-and-forget). Регекс без `_`, поэтому `emp_`/`tr_` сюда не попадают. Неизвестный код — тишина. Команды `/ref` и `/stat` остались эксклюзивом сотрудников.
  - **Крон — `server/src/jobs/userInvites.js` (новый).** `runUserInviteChecks()`: `pending` старше 24 ч → `confirmed`/`rejected` по `app_opened && channel_member && !tg_unreachable`, guard `AND status='pending'` от гонки, ЛС приглашающему + пост в лог-канал. Регистрация — `jobs/notifications.js`, `cron.schedule("25 * * * *", …)` (на 5 мин позже сотрудничьего на `:20`). Фазы атрибуции оплат нет.
  - **Лог-канал.** Новый ключ `invites` в `tg_log_events` (`server/src/utils/settings.js`) + подпись в `LOG_EVENTS` (`admin/src/pages/Settings.jsx`) — поток приглашений выключается отдельно от сотрудничьего.
  - **API мини-аппа — `server/src/routes/invite.js` (новый), `GET /api/invite`.** `router.use(auth)` без гейтов — доступно всем. Отдаёт `{ code, link, share_text, stats }`. `share_text` БЕЗ самой ссылки: `t.me/share/url?url=…&text=…` подставляет URL из `url=`, иначе задваивается (тот же приём, что в `routes/trainer.js`). Смонтирован в `app.js` как `/api/invite`.
  - **Экран — `client/src/pages/Invite.jsx` (новый), роут `/invite`.** Карточка со ссылкой + `Поделиться`/`Копировать` (`WebApp.openTelegramLink` с фолбэком на буфер, как в `pages/Trainer.jsx`), сетка 2×2 со статистикой (засчитано / на проверке / переходы / отклонено), блок правил. Вход — `SectionCard «Приглашай друзей»` в `client/src/pages/Profile.jsx` между «Моя подписка» и блоком тренера, видна всем. API-обёртка `Invite` в `client/src/api/index.js`.
  - **Чистка.** Из `login()` (`client/src/api/index.js`) убран мёртвый параметр `ref`: сервер игнорировал его с Поправки №23, а привязка теперь делается ботом на `/start`.
  - **Админка — `server/src/routes/adminInvites.js` (новый), смонтирован ДО общего `adminRouter`.** `GET /api/admin/invites?from=&to=` — сводка + топ приглашающих (`GROUP BY u.id`, `ORDER BY confirmed DESC, total DESC`); `GET /api/admin/invites/feed?status=&page=&limit=` — сквозная лента с пагинацией (объявлен ДО `/:userId`, иначе `feed` уехал бы в `parseId`); `GET /api/admin/invites/:userId` — карточка: цифры, график 30 дней через `generate_series` + `AT TIME ZONE`, все приведённые поимённо с флагом `user_paid`. Границы периода включительные, `to` разворачивается в конец дня.
  - **Админка — `GET /api/admin/users/:id` (`routes/admin.js`).** Добавлены `invite_source` (`kind: user|employee` + кто и статус; сначала ищем в `user_invites`, затем в `employee_referrals`) и `invites_sent` (`confirmed`/`pending`/`total`).
  - **Фронт админки.** `admin/src/pages/Invites.jsx` (фильтр периода, `grid cols-4`, топ с медалями 🥇🥈🥉, лента с фильтром по статусу и пагинацией; экспортирует `INVITE_STATUS`, `REJECT_REASONS`, `personName`), `admin/src/pages/InviteCard.jsx` (цифры, конверсия, recharts-график, кнопка «🎁 Выдать PRO» через готовые `askGrantBody`/`GRANT_PERIODS`/`Admin.grantSub`), неймспейс `Invites` в `admin/src/api.js`, роуты `/invites` и `/invites/:id`, пункт «Приглашения» в `NAV` (`components/Layout.jsx`), блок «Приглашения» в `UserModal` (`pages/Users.jsx`). Переиспользованы `AvatarDot`/`CopyButton` из `pages/Employees.jsx`.

- **Поправка №46 — 2026-07-19 (Главная админки: карточка «Баланс GPT API» — остаток в рублях)**:
  - **Контекст.** OpenAI не отдаёт остаток баланса через API — только расход (Costs API). Поэтому админ вписывает текущий баланс кабинета OpenAI (в долларах), а система показывает на Главной остаток в рублях = баланс − потрачено с момента ввода. Курс — ЦБ РФ (сервис `fx`).
  - **Настройки — `server/src/utils/settings.js`.** DEFAULTS: `openai_balance_usd: 0` (сумма, введённая вручную) и `openai_balance_at: null` (дата ввода — с неё считается расход). Баланс `0` → карточка на Главной скрыта.
  - **Сервис — `server/src/services/openaiCosts.js`.** Добавлен `getSpentUsdSince(startMs)`: сумма расхода в $ с указанного момента через `GET /v1/organization/costs` (`bucket_width=1d`, `start_time`), с кэшем на 1 час по дню старта; `null`, если нет `OPENAI_ADMIN_KEY` или запрос упал. Экспорт дополнен.
  - **Роут — `server/src/routes/admin.js`.** `GET /dashboard`: если `openai_balance_usd > 0`, считает `spentUsd` (реальный из Costs API, иначе fallback `SUM(ai_usage.cost_usd) WHERE created_at >= openai_balance_at`), `gpt_balance_rub = round(max(0, balance − spent) × rate)`; отдаёт `gpt_balance_rub`, `gpt_balance_is_real`, `gpt_balance_updated_at`. `PUT /settings`: принимает `openai_balance_usd` (вне общего allowlist), дату `openai_balance_at` обновляет ТОЛЬКО при изменении суммы — иначе сохранение других вкладок обнуляло бы «потрачено».
  - **Админ-UI.** `admin/src/pages/Dashboard.jsx`: карточка `Stat` «Баланс GPT API» (показывается при `gpt_balance_rub != null`), подпись «осталось (данные OpenAI)» / «осталось (оценка)». `admin/src/pages/Settings.jsx` (таб «Пробный период и лимиты»): карточка «Баланс GPT API (OpenAI)» — поле ввода в $, дата последнего задания баланса; `save()` кладёт `openai_balance_usd` в payload.

- **Поправка №45 — 2026-07-16 (таргет-рассылки по сегментам/людям, экран Pro вместо тоста + редактируемый оффер, апселл-пуш при исчерпании дневного лимита)**:
  - **Контекст.** Развитие раздела «Рассылки» и монетизации. Нужно: слать рассылки не только 4 фикс-аудиториям, но и по новым сегментам и конкретным людям; при упоре в лимит открывать полноценный экран Pro (а не мелкий тост, как было при добавлении текстом); показывать на нём редактируемый из админки оффер; и слать апселл-пуш пробному юзеру, когда закончились дневные сканы. Признак подписчика во всём проекте — активная строка `subscriptions` (`status='active' AND expires_at > NOW()`, тип `basic`/`trainer`).
  - **БД (`server/src/db/schema.sql`).** Идемпотентно: `broadcasts.target_user_ids INTEGER[]` (получатели точечной рассылки, NULL для сегментов) + расширен комментарий к `audience`; `users.limit_push_at TIMESTAMPTZ` (дедуп апселл-пуша 1/сутки).
  - **Рассылки — `server/src/services/broadcast.js`.** `audienceSql` расширен кейсами `expiring` (активна, истекает ≤3 дн.), `churned` (была подписка, активной нет), `sub_basic`/`sub_trainer` (по `type`), `inactive` (`app_opened=FALSE OR channel_member=FALSE`); общий подзапрос активной подписки вынесен в `ACTIVE_SUB`. `recipients(audience, targetUserIds)` — для `audience='user'` отдельный запрос `WHERE is_blocked=FALSE AND tg_unreachable=FALSE AND u.id = ANY($1::int[])` (notifications_enabled НЕ учитываем — админ выбрал людей осознанно). `createBroadcast` пишет `target_user_ids`, `runBroadcast` их передаёт.
  - **Роут — `server/src/routes/admin.js`.** `POST /broadcasts`: whitelist аудиторий вынесен в `AUDIENCES` (+`expiring, churned, sub_basic, sub_trainer, inactive, user`); при `user` парсит `target_user_ids` (JSON, только целые >0), пусто/криво → `400 no_target_users`; прокидывает `targetUserIds` в `createBroadcast`.
  - **Админ-UI — `admin/src/pages/Notifications.jsx`.** Карта `AUDIENCE` и `<select>` дополнены новыми лейблами. Блок «Получатели» при `audience='user'`: поиск через `Admin.users({search, limit})` (по имени/@username/telegram_id), результаты таблицей с «+ Добавить», выбранные — чипами с удалением; `send()` блокирует пустой список и кладёт `target_user_ids` (JSON) в `FormData`. В истории для `user` — «Выборочно (N)» из `target_user_ids.length`.
  - **Оффер Pro — настройки.** `server/src/utils/settings.js` DEFAULTS: `paywall_text` переписан с плейсхолдером `{limit}`; добавлен `paywall_features` (массив буллетов). `server/src/routes/settingsPublic.js` отдаёт `paywall_features` (и уже отдавал `free_scan_daily_limit`). `admin.js` allowlist PUT /settings: +`paywall_features`, +`limit_push`. `admin/src/pages/Settings.jsx` (таб «Тексты»): редактор списка `paywall_features` (add/remove/inline) + карточка «Пуш при исчерпании лимита» (чекбокс enabled, textarea text, поле button_text); оба уходят в payload `save()`.
  - **Клиент — экран Pro вместо тоста.** `client/src/ui/addByText.jsx`: при `403 && error==='limit'` вместо `ui.toast` — `close()` + новый колбэк `onLimit()`; `openAddByText(ui, onAdded, tz, onLimit)`. `client/src/pages/Home.jsx`: оба вызова передают `() => navigate("/paywall")`. `client/src/pages/Paywall.jsx`: `fillLimit()` подставляет `cfg.free_scan_daily_limit` в `{limit}` (в subtitle и буллетах); над тариф-карточками — заметный градиентный блок (`var(--grad)`) из `cfg.paywall_features` с галочками.
  - **Апселл-пуш — `server/src/middleware/checkLimit.js`.** DEFAULTS `limit_push {enabled, button_text, text}` (server/src/utils/settings.js). В ветке `daily_cap` (юзер ещё в триале — `trial_expired` возвращается раньше и покрыт кроном `subscriptionReminders.js`, чтобы не дублировать) — fire-and-forget `maybeSendLimitPush(user, dailyLimit, tz)`: если `enabled=false`/нет текста — выход; дедуп атомарный через `UPDATE users SET limit_push_at=NOW() WHERE id=$1 AND (limit_push_at IS NULL OR (limit_push_at AT TIME ZONE tz)::date < (NOW() AT TIME ZONE tz)::date)` — право на пуш «занимает» только реально обновивший запрос (гонок одновременных сканов нет); шлёт `sendMessage` с кнопкой на `t.me/${TELEGRAM_BOT_USERNAME||Bytwise_bot}?startapp=paywall`; на `error_code===403` — `tg_unreachable=TRUE`.
  - **Проверка.** `node --check` всех 5 изменённых серверных файлов — OK; esbuild-трансформация 5 изменённых JSX — OK. Локально БД нет — `npm run migrate` не гонялся: обе колонки идемпотентны (`ADD COLUMN IF NOT EXISTS`), применятся на старте `db.init()`. После деплоя проверить: точечную рассылку и сегменты (совпадение `sent_count` с `SELECT COUNT(*)` по `audienceSql`), открытие пейволла при лимите текстом и фото + буллеты из настроек, апселл-пуш при исчерпании (и дедуп при повторном упоре в тот же день, и выключение через `limit_push.enabled`).
  - В публичный `CHANGELOG.md` вынесён внутренний пост «для владельца» (новые экраны видит только владелец/админ; апселл-пуш и экран Pro — пользовательские, но публиковать отдельным анонсом не требуется).

- **Поправка №44 — 2026-07-03 (актуализированы тесты calcDailyNorms под формулу Поправки №37)**:
  - **Контекст.** 2 теста в `server/tests/calories.test.js` падали с Поправки №37: они были написаны под старую формулу (loss −500; goal как входной параметр). Текущее поведение: BMR от ЦЕЛЕВОГО веса, направление цели выводится `deriveGoal(weight, target_weight)` (переданный goal игнорируется), дельты −300/0/+300, пол 1500/1200.
  - **`server/tests/calories.test.js`** переписан: maintain без целевого веса (2759 — как раньше), loss через `target_weight` (60→55: BMR от 55, ×1.2, −300 = 1254), gain через `target_weight` (80→90: BMR от 90, ×1.725, +300 = 3543), новый тест защитного пола (1200), null на неполных данных и макросы 30/30/40 — без изменений, плюс юнит-тесты `deriveGoal` (loss/gain/maintain/допуск ±1 кг). Код формулы не менялся.
  - **Проверка.** `npm test` в `server/` — 5 suites, 39 тестов, все зелёные.
  - В публичный `CHANGELOG.md` не выносится (только тесты).

- **Поправка №43 — 2026-07-03 (сотрудники-пиарщики: реф-ссылки emp_, подтверждение 24 ч, атрибуция оплат, выплаты, раздел «Работники» в админке)**:
  - **Контекст.** Владелец нанимает людей для пиара Bytwise. Нужны: выдача роли сотрудника через админку (по Telegram ID / @username), персональная реф-ссылка (`/ref`, только сотрудникам), статистика (`/stat`), раздел «Работники» в админке с карточкой каждого (рефералы поимённо, графики, выручка, история выплат) и учёт выплат (вручную вне системы, тут только отметка). Согласованные правила: реферал = только НОВЫЙ пользователь (не сам сотрудник и не другой сотрудник); подтверждение через 24 ч (открыл приложение + в канале + не заблокировал бота — состояние на момент проверки); каждая оплата реферала (включая продления, бессрочно) засчитывается; выплата закрывает ВСЁ невыплаченное выбранного типа (кол-во × ставка, ставку вводит владелец), отменяема; сотрудник видит только цифры; удаление гасит ссылку, история остаётся; статистика по Москве.
  - **БД (`server/src/db/schema.sql`).** Новый блок из 5 таблиц (идемпотентно, legacy `referrals`/`referral_balance` не тронуты): `employees` (user_id UNIQUE, code UNIQUE, active, added_by, deactivated_at), `employee_payouts` (kind referrals|subscriptions, unit_count, unit_rate ₽, total, status paid|cancelled, cancelled_by/at), `employee_link_clicks` (каждый /start по emp_-ссылке; existing_user=TRUE если рефералом не стал), `employee_referrals` (user_id UNIQUE — один юзер=один сотрудник; status pending|confirmed|rejected; reject_reason app_not_opened|left_channel|blocked_bot; payout_id NULL=не выплачено), `employee_payments` (payment_id UNIQUE — идемпотентность атрибуции; amount; payout_id). Индексы по (employee_id, created_at/status). CASCADE от users/payments — админское удаление юзера само чистит реф-строки.
  - **`server/src/utils/refcode.js`.** Новый `uniqueEmployeeCode()` — тот же 8-hex генератор, но уникальность по `employees.code` (не трогает `uniqueRefCode` тренеров).
  - **Новый сервис `server/src/services/employeeReferrals.js`.** Вся бизнес-логика в одном месте: `getActiveEmployeeByTg` (гейт /ref и /stat), `buildLink` (`t.me/<TELEGRAM_BOT_USERNAME>?start=emp_<code>`), `handleStartLink` (неактивный код → тихо выйти; клик пишется всегда; реферал — только `inserted===true` && не сам && не сотрудник, `ON CONFLICT (user_id) DO NOTHING`; ЛС сотруднику без имён + лог-канал с именами), `attributePaymentsSince(interval)` (один идемпотентный INSERT…SELECT из `payments` succeeded × `employee_referrals` со status<>'rejected', `ON CONFLICT (payment_id) DO NOTHING`; по вставленным — ЛС активному сотруднику + лог; ловит и `recordManualPayment`, и mock), `statsForEmployee` (день-МСК / 7 дн / 30 дн + итоги выплачено/не выплачено; FILTER-агрегаты, TZ `Europe/Moscow`), уведомления `notifyGranted`/`notifyPayout`/`notifyPayoutCancelled` (ЛС + `channelLog.post("employees", …)`).
  - **Лог-канал.** Новый ключ события `employees: true` в `tg_log_events` (`server/src/utils/settings.js` DEFAULTS) + тумблер «Сотрудники-пиарщики» в `admin/src/pages/Settings.jsx` (TG_LOG_EVENTS). Канал прежний (`tg_log_channel_id`, дефолт −1004283676399 «Логи Bytwise»); `channelLog.allowed()` блокирует только явный `false`, поэтому на старых БД с сохранённым `tg_log_events` без нового ключа событие постится — сид не нужен.
  - **`server/src/services/bot.js`.** В `bot.start` сразу после `registerStartUser` и ДО проверки подписки на канал: парс `ctx.payload` по `/^emp_([0-9a-f]+)$/i` → `handleStartLink` fire-and-forget (подписка на канал — условие подтверждения, не привязки). Команды `bot.command("ref")` и `bot.command("stat")` рядом с `help`; первая строка обеих — гейт `getActiveEmployeeByTg`, не сотруднику молчим (бот и так не отвечает на неизвестные команды — фича не светится). `/ref` — ссылка (превью отключено `link_preview_options`) + правила зачёта; `/stat` — переходы/рефералы/оплаты за день·7·30 дн (МСК) + «на проверке» + итоги выплачено/ждут и сумма выплат.
  - **`server/src/routes/subscription.js`.** В `fulfillPayment` после COMMIT, рядом с `notifyPurchase`: `employeeReferrals.attributePaymentsSince("1 hour")` fire-and-forget. Дубли вебхука отсекаются ранним `applied=false` + UNIQUE(payment_id).
  - **Новый джоб `server/src/jobs/employeeReferrals.js`** (`runEmployeeReferralChecks`, cron `20 * * * *` из `notifications.js start()`). Фаза A: pending старше 24 ч → confirmed (`app_opened AND channel_member AND NOT tg_unreachable`) или rejected с reject_reason (первая непройденная проверка); UPDATE c guard `AND status='pending'`; итог каждого — в лог-канал (сотруднику ЛС не шлём, видит в /stat). Фаза B: `attributePaymentsSince("2 days")` — reconcile после падений + ручные начисления. Оплаты позже отклонённого реферала остаются засчитанными (реальная выручка; решение зафиксировано).
  - **Новый роут `server/src/routes/adminEmployees.js`** (монтирован в `app.js` как `/api/admin/employees` ДО общего `adminRouter`; внутри `router.use(adminAuth)`): `GET /` — список с агрегатами (клики, confirmed/pending, оплаты, выручка, не выплачено, выплачено); `POST / {query}` — число→telegram_id, иначе @username (LOWER), не найден → 404 `user_not_found`; upsert `ON CONFLICT (user_id) DO UPDATE SET active=TRUE, deactivated_at=NULL` — при возврате уволенного код и история сохраняются, код генерится только на INSERT; side-effects: `notifyGranted` + `system_logs admin_action`; `DELETE /:id` — active=FALSE (история цела); `GET /:id` — карточка (stats, рефералы поимённо с числом оплат/выручкой/paid_out, история выплат, график 30 дн по московским датам через generate_series); `POST /:id/payouts {kind, rate}` — в `db.withTx`: заготовка payout → штамп `payout_id` на все `WHERE payout_id IS NULL` (confirmed-рефералы или employee_payments) → `unit_count`/`total = n × rate`; n=0 → 400 `nothing_to_pay` (rollback); после — `notifyPayout`; `POST /:id/payouts/:payoutId/cancel` — в tx: status='cancelled' (guard status='paid', иначе 409) + `payout_id=NULL` у покрытых строк → `notifyPayoutCancelled`.
  - **Админка.** `admin/src/api.js`: объект `Employees` (list/add/remove/detail/payout/cancelPayout). `components/Layout.jsx`: пункт «Работники» после «Пользователи». `App.jsx`: роуты `/employees` и `/employees/:id`. Новая `pages/Employees.jsx`: форма добавления (ID или @username; 404 → «Этот человек ещё не запускал бота…»), таблица с цифрами и копированием ссылки, «Убрать»/«Вернуть», клик по строке → карточка. Новая `pages/EmployeeCard.jsx`: стат-карточки, 2 графика recharts (Area переходы+рефералы, Bar оплаты; паттерн Dashboard.jsx), панель «Отметить выплату» (тип → «Не выплачено: N» → ставка → «Итого N × R ₽» → подтвердить), история выплат с «Отменить», рефералы поимённо (статус + причина отклонения, оплат, принёс, выплачен).
  - **Проверка.** `node --check` всех 9 изменённых/новых серверных файлов — OK; `npm run build` админки (Vite) — OK. `npm test` (jest): мои suites зелёные; 2 падения в `tests/calories.test.js` — УНАСЛЕДОВАННЫЕ (тесты написаны под старую формулу до Поправки №37: ждут loss −500 и goal без target_weight; к этой правке отношения не имеют, вынесено в отдельную задачу). Локально БД нет (прод на VPS) — `npm run migrate` не гонялся: schema.sql идемпотентен и применится на старте сервера (`db.init()`); после деплоя проверить сценарии: добавление сотрудника, /ref от сотрудника и чужого, переход по emp_-ссылке с нового/старого аккаунта, крон-проверка 24 ч, оплата реферала (строка в employee_payments + ЛС + лог), выплата и её отмена, увольнение (ссылка гаснет, карточка цела).
  - **Доработки по ревью (тот же день).**
    - **`statsForEmployee` — периоды считают ПРИШЕДШИХ, а не подтверждённых.** Подтверждение происходит через 24 ч, поэтому «засчитанные за день» по `created_at` были бы всегда 0. Теперь день/7/30 дн — `status <> 'rejected'` по `created_at` (в /stat подпись «Новые рефералы»); итоги (confirmed/pending/paid/unpaid) — точные по статусам.
    - **Окно атрибуции в хуке оплаты расширено до `2 days`** (было `1 hour`): `payments.created_at` — момент СОЗДАНИЯ заказа (buy), вебхук может прийти позже часа.
    - **`POST /api/admin/employees` → 409 `already_employee`**, если человек уже активный сотрудник (раньше upsert-«no-op» повторно слал ЛС «роль выдана»).
    - **UI «Работники» отполирован.** Список: сводные стат-карточки сверху (приведено людей / принесли денег / выплачено / ждут выплаты), аватарки-кружки с первой буквой (`AvatarDot`), кнопка копирования с «✓ Скопировано» (`CopyButton`, оба экспортируются и переиспользуются в карточке), amber-пилюли для «на проверке»/«не выплачено», зелёная плашка успеха после добавления, форма добавления в topbar, подсказка о правилах под таблицей. Карточка: выплата переехала в модалку (`.modal-back`/`.modal`) с выбором типа крупными кнопками (на каждой видно «не выплачено: N»), полем ставки (autoFocus) и итогом `кол-во × ставка` в строках `.kv`; на кнопке «Выплатить» в шапке — счётчик невыплаченного; статусы рефералов цветными пилюлями (amber/green/red) с причиной отклонения, «ждёт» у невыплаченных, «сегодня: N» в переходах.
  - **Деплой.** Бот уже админ лог-канала (канал тот же). Новых env нет (используется существующий `TELEGRAM_BOT_USERNAME`). В BotFather команды `ref`/`stat` добавлять НЕ надо (иначе их увидят все в меню) — команды скрытые, работают без регистрации в меню.
  - В публичный `CHANGELOG.md` не выносится (функционал для владельца и нанятых пиарщиков; обычные пользователи изменений не видят).

- **Поправка №42 — 2026-07-02 (аудит всего проекта на баги: 4 мелких фикса — напоминания с одинаковым часом, ошибка загрузки на «Управлении подпиской», защита «Расходов на ИИ», комментарий о гонке лимита)**:
  - **Контекст.** Полный аудит проекта на баги (server, client, admin, support): три параллельных проверки + ручная перепроверка каждой находки. Критичных багов не найдено — платежи ЮKassa (идемпотентность вебхука, транзакции), авторизация (HMAC initData, timing-safe, свежесть auth_date), лимиты и часовые пояса (`AT TIME ZONE` с tz пользователя) корректны. Подтвердились 4 мелочи — все исправлены.
  - **`server/src/jobs/notifications.js` — совпадающие часы напоминаний затирали друг друга.** Карта `час→приём` строилась объектом `{ [breakfast_hour]: "breakfast", ... }`: при одинаковых часах у двух приёмов (настройка в админке) ключи перезаписывались и отправлялось только одно напоминание. Теперь `hourMeals` — карта `час→[приёмы]` (массив), в `mealReminders()` внутренний цикл `for (const meal of meals)`; вся логика отправки/счётчиков (skipped/sent/failed/blocked, 403→`markUnreachable`) не менялась, только обёрнута в цикл.
  - **`client/src/pages/ManageSubscription.jsx` — тихий сбой загрузки.** Раньше `Settings.public()` и `Subscription.payments()` глотали ошибки (`catch(() => {})`) — при сбое сети страница оставалась пустой без кнопок покупки и без объяснения. Теперь обе загрузки объединены в `loadData()` (`Promise.all`), при ошибке — стейт `loadFailed`: карточка «Не удалось загрузить тарифы и историю платежей…» с кнопкой «Повторить» (класс `sheet-btn ghost`), а в «Истории платежей» вместо ложного «Платежей пока нет.» — «Не удалось загрузить историю.».
  - **`server/src/routes/admin.js` + `admin/src/pages/AIAnalytics.jsx` — защита «Расходов на ИИ» от NULL.** В `top_users` было `SUM(a.total_tokens)::int AS tokens` без COALESCE: если у пользователя все строки `ai_usage` со старым NULL в `total_tokens`, SUM даёт NULL → `u.tokens.toLocaleString()` ронял страницу белым экраном (и такой пользователь сортировкой `ORDER BY tokens DESC` всплывал первым — NULLS FIRST). Фикс: `COALESCE(SUM(a.total_tokens),0)::int` на сервере + `(u.tokens || 0).toLocaleString()` на клиенте. Текущий код (`aiUsage.record`) всегда пишет числа — риск только на исторических строках.
  - **`server/src/middleware/checkLimit.js` — задокументирована принятая гонка.** Проверка дневного лимита и вставка скана не атомарны (TOCTOU): несколько строго одновременных запросов бесплатного пользователя могут превысить лимит на 1–2 скана. Риск принят осознанно (ущерб — копейки на AI-вызовах; advisory lock усложнил бы код) — добавлен комментарий, код не менялся.
  - **Отклонённые «находки» аудита (перепроверены, НЕ баги):** пути в `caddy/Caddyfile` (`C:\Users\Admin\Desktop\Bytwise`) верны для прод-VPS; `toFixed(2)` в платежах безопасен (цены — целые рубли из настроек); идемпотентность вебхука ЮKassa тройная (dup-check + частичный UNIQUE + 23505); проценты БЖУ в `Stats.jsx` сходятся ровно в 100 по построению; гонка вкладок статистики закрыта флагом `alive`; «завтра» в истории закрыто серверным `server_today`; `restore.bat` при запущенном сервере просто падает с понятной ошибкой (DROP DATABASE атомарен).
  - **Проверка.** `node --check` для трёх серверных файлов — OK; JSX (`ManageSubscription.jsx`, `AIAnalytics.jsx`) прогнаны через esbuild — OK. Локально нет `node_modules` (код-копия, прод на VPS) — сборки Vite не гонялись; после деплоя проверить: страница «Расходы на ИИ» открывается, «Управление подпиской» без сети показывает карточку с «Повторить».
  - Публичный пост — в `CHANGELOG.md` (пользователи видят понятную ошибку вместо пустого экрана подписки).

- **Поправка №41 — 2026-06-29 (точнее КБЖУ через промпт + полное чтение упаковки; подсказки-чипы из истории/популярного; помарочки при добавлении)**:
  - **Контекст.** По опросам пользователей две боли — «неточно считает КБЖУ» и «неудобно добавлять частые блюда». Решаем без смены модели: усиливаем промпт (в т.ч. полное чтение задней стороны упаковки), показываем умные чипы при вводе текстом, добавляем подсказки-помарочки. Все новые тексты — на тема-переменных (видны в светлой и тёмной теме).
  - **`server/src/services/openai.js` (промпты, модели НЕ менялись — фото `gpt-4.1`, текст `gpt-4.1-mini`).** В `IMAGE_PROMPT` добавлен явный приоритетный блок «УПАКОВКА / ЭТИКЕТКА»: если видна таблица «Пищевая ценность» — читать ПОЛНОСТЬЮ (ккал/Б/Ж/У на 100 г или на порцию, состав, бренд/название, «масса нетто», число порций), пересчитывать на съеденную массу (`итог = на_100г × масса_г ÷ 100`), при съеденной целиком упаковке брать массу нетто. В порядок действий добавлена проверка наличия этикетки ПЕРВЫМ шагом и требование фиксировать в `analysis` источник чисел («с этикетки» / «визуальная оценка»). Старая одиночная строка про этикетку заменена ссылкой на блок. Добавлен второй пример (упаковка йогурта). В `TEXT_PROMPT` — пункт: если пользователь привёл КБЖУ на 100 г и массу, пересчитать на массу, а не возвращать на 100 г. Логика `reconcileMacros`/`normalizeDish` без изменений (подстраховка Атуотера и >9 ккал/г).
  - **`server/src/routes/scan.js` — новый `GET /api/scan/suggestions` (auth).** Возвращает `{ recent, popular }`. `recent` — последние уникальные блюда пользователя по времени, любой источник: `SELECT dish_name, MAX(scanned_at) ... WHERE user_id=$1 AND dish_name<>'' GROUP BY dish_name ORDER BY last_at DESC LIMIT 6`. `popular` — глобальный топ по всем юзерам (`GROUP BY dish_name ORDER BY COUNT(*) DESC LIMIT 4`) с кэшем в памяти модуля (`POPULAR_TTL` 1 ч) и фолбэком `FALLBACK_POPULAR` (4 блюда), если в базе < 4 названий. Маршрут добавлен ДО `router.post("/")`; конфликта с `:id` нет (там нет GET).
  - **`client/src/api/index.js`.** В `Scan` добавлен `suggestions: () => api.get("/scan/suggestions")…`.
  - **`client/src/ui/addByText.jsx`.** Стейты `chips`/`chipKind` (старт — `EXAMPLES.slice(0,4)`, фолбэк при ошибке сети). Отдельный `useEffect([])` грузит `Scan.suggestions()` один раз при открытии: есть `recent` → чипы из последних (6) и `chipKind="recent"`, иначе `popular` (4) и `"popular"`. Над чипами подпись «Недавнее»/«Популярное» (`var(--text-2)`). **Поведение чипа изменено:** `onClick` теперь `setText(x)` + фокус на поле (вместо немедленного `analyze(x)`) — текст вставляется для редактирования. Под полем ввода добавлена помарочка про меньшую точность текста (13px, `var(--text-2)`). Enter и кнопка «Посчитать КБЖУ» не тронуты.
  - **`client/src/components/TabBar.jsx` и `client/src/components/CameraButton.jsx`.** В `pickSource` (`ui.sheet type:"info"`) добавлено поле `sub` с подсказкой «если еда в упаковке — фоткайте сторону с составом и КБЖУ». Рендерится через существующий `Header`/`.sheet-sub` (`var(--text-2)`), доп. вёрстки не требует. Правка продублирована в оба файла (общий код кнопки камеры).
  - **Тема.** Все новые тексты на `var(--text-2)`/`var(--text-3)` (заданы для `[data-theme="light"]` и `[data-theme="dark"]` в `App.css`) — читаются в обеих темах, хардкода цветов нет.
  - **Проверка.** `node --check` для `openai.js` и `scan.js` — OK. Локально нет `node_modules` (код-копия, прод на VPS), поэтому Jest/Vite не гонялись; e2e-проверка на VPS после деплоя (этикетка → числа близки к таблице; чипы новичку/опытному; помарочки в обеих темах).
  - Публичный пост — в `CHANGELOG.md` (пользователи видят точнее КБЖУ, чтение упаковки, быстрые чипы, подсказки).

- **Поправка №40 — 2026-06-19 (логи в канал: новый пользователь = подписчик канала, выход из канала, ещё 7 событий + «Всего пользователей» = подписчики)**:
  - **Контекст.** Лог «👤 Новый пользователь» уходил на голом `/start` — до проверки подписки на обязательный канал, поэтому считались и те, кто отвалился на шлагбауме. Событий выхода из канала не было вовсе. Бизнес-правило: «пользователь = подписчик обязательного канала» (без подписки ботом пользоваться нельзя), поэтому и счётчик «Всего пользователей», и лог «новый» должны опираться на членство в канале. Плюс пользователь попросил набор новых событий для канала логов.
  - **БД (`server/src/db/schema.sql`).** В `users` добавлены `channel_member BOOLEAN DEFAULT FALSE`, `channel_joined_at TIMESTAMPTZ`, `channel_left_at TIMESTAMPTZ`. Одноразовый бэкофилл: `UPDATE users SET channel_member=TRUE, channel_joined_at=COALESCE(channel_joined_at, created_at) WHERE app_opened=TRUE AND channel_joined_at IS NULL` (кто открывал приложение — уже прошёл шлагбаум; условие `channel_joined_at IS NULL` делает его одноразовым). В `subscriptions` добавлен `expiry_logged_at TIMESTAMPTZ` (дедуп лога окончания).
  - **Новый сервис `server/src/services/channelMembership.js`.** Три идемпотентных хелпера: `markChannelJoined(userId, source)` — `UPDATE ... SET channel_member=TRUE, channel_joined_at=COALESCE(channel_joined_at, NOW()) WHERE id=$1 AND channel_joined_at IS NULL RETURNING id`; если строка вернулась (членство ВПЕРВЫЕ) → `notify.notifyNewUser(userId, source)` (лог «новый пользователь» ровно один раз); иначе добивает `channel_member=TRUE` для вернувшихся. `markChannelLeft(userId)` — `SET channel_member=FALSE, channel_left_at=NOW() WHERE channel_member=TRUE` → лог `channel_left`. `markUnreachable(userId)` — `SET tg_unreachable=TRUE WHERE tg_unreachable=FALSE` → лог `blocked_bot` (по одному разу).
  - **`server/src/services/notify.js`.** `notifyNewUser(userId, source="channel")`: новый текст для `source==="channel"` → «подписался на канал и открыл бота» (плюс старые `app`/`start`). Экспортированы `userLabel` и `fmtWhen` для переиспользования. `notifyPurchase(userId, {amount,type,renewal})`: при `renewal` — заголовок «🔁 Продление подписки», текст пользователю «продлена», и постит в тип лога `subscription_renew` вместо `payments`.
  - **`server/src/services/bot.js`.** В `/start` убран безусловный `notifyNewUser` на INSERT; теперь при `isChannelMember` → `markChannelJoined`. В `check_sub` (кнопка «Я подписался») при подтверждении → `markChannelJoined`. Новый `bot.on("chat_member")`: фильтр по `REQUIRED_CHANNEL_ID`, вход (`member/administrator/creator`) → `markChannelJoined`, выход (`left/kicked`) → `markChannelLeft`; `userIdByTg(tg)` мапит telegram_id→users.id. В `launchBot` добавлен `b.launch({ allowedUpdates: ["message","edited_message","callback_query","my_chat_member","chat_member"] })` — без явного списка Telegram не шлёт `chat_member`. **Прод-требование:** бот должен быть админом обязательного канала, иначе выход и точный счётчик не работают.
  - **`server/src/routes/auth.js`.** Для нового через приложение (`wasInserted`) вместо прямого `notifyNewUser` → `markChannelJoined(user.id, "app")`. Добавлен лог `reactivation`: в ветке существующего юзера запоминаем `prevLogin = user.last_login_at` ДО апдейта; если пауза `>= REACTIVATION_DAYS` (14) → `channelLog.post("reactivation", …)`.
  - **`server/src/routes/admin.js`.** Дашборд: `total_users` → `COUNT(*) WHERE channel_member=TRUE`; `new_today` → по `channel_joined_at` за сегодня (Asia/Yekaterinburg).
  - **`server/src/jobs/notifications.js`.** 403-обработка в `mealReminders` переведена на `channelMembership.markUnreachable`. Новая `dailyDigest()` (cron `0 21 * * *` Europe/Moscow) → сводка за сутки (новые/вышли/активные/сканы/оплаты/истёкшие/всего) в тип `daily_digest`. Новая `subscriptionExpiryCheck()` (cron `10 * * * *`): подписки с `expires_at` в окне последних 2 суток, `expiry_logged_at IS NULL` и без более поздней активной → лог `subscription_expired`, отметка `expiry_logged_at` до лога (дедуп). Окно 2 суток вместо бэкофилла — чтобы не залить канал историческими истечениями.
  - **`server/src/jobs/subscriptionReminders.js`.** 403-обработка переведена на `channelMembership.markUnreachable`.
  - **`server/src/routes/subscription.js`.** `fulfillPayment`: внутри транзакции `isRenewal = есть ли прежняя строка subscriptions у юзера`, передаётся в `notifyPurchase({renewal})`. `/buy`: после создания pending-заказа ЮKassa → лог `payment_started`. `/cancel`: `UPDATE ... WHERE auto_renew=TRUE RETURNING id`, при отключении → лог `autorenew_cancel`.
  - **Настройки/админка.** `server/src/utils/settings.js`: в `tg_log_events` добавлены `channel_left, blocked_bot, reactivation, daily_digest, payment_started, subscription_renew, subscription_expired, autorenew_cancel` (все `true`). `admin/src/pages/Settings.jsx`: те же пункты добавлены в `TG_LOG_EVENTS` с человеческими названиями и подсказками. `users`-пункт переформулирован под «подписался на канал».
  - **Доработки по ревью (тот же день).**
    - **«Пользователь» = подписчик канала И открывал приложение.** В канале есть читатели новостей и есть те, кто нажал `/start`, но не зашёл в апп — они не пользователи. Дашборд (`total_users`/`new_today`) и `dailyDigest` (новые/всего) считают `channel_member = TRUE AND app_opened = TRUE`. (Читатели новостей и так не в `users` — они не взаимодействовали с ботом.)
    - **`subscription_expired` без всплеска на первом деплое.** В `schema.sql` бэкофилл `UPDATE subscriptions SET expiry_logged_at = NOW() WHERE expires_at < NOW() - interval '2 days' AND expiry_logged_at IS NULL` — всё, что истекло раньше окна детектора (2 сут), помечается как залогированное; свежие истечения ловит джоб. Счётчик «закончились подписки» в сводке получил тот же `NOT EXISTS (более поздняя активная)`, что и логируемое событие.
    - **Активные / неактивные пользователи.** Универсум = `app_opened = TRUE`. **Активный** = `channel_member = TRUE AND tg_unreachable = FALSE` (подписчик канала, бот не в ЧС). **Неактивный** = `channel_member = FALSE OR tg_unreachable = TRUE` (отписался/не подписан или заблокировал бота). Данные неактивных НЕ удаляются — меняется только статус. Дашборд (`admin.js`): `total_users`=`active_users`=активные, добавлен `inactive_users`; конверсия считается от активных. `Dashboard.jsx`: карточки «Активные пользователи» и «Неактивные (отписались / в ЧС)». `dailyDigest`: строки «Активных пользователей» / «Неактивных». Список пользователей (`GET /users`): в выборку добавлены `channel_member`/`tg_unreachable`, фильтр `?active=true|false`; `Users.jsx`: выпадашка «Все/Активные/Неактивные», бейдж статуса в строке и пилюля в карточке.
    - **`bot.on("chat_member")`** берёт чат из `upd.chat?.id` (не из геттера `ctx.chat`) — надёжнее.
    - **Фикс «Платёж не завершён» (`notify.notifyPaymentFailed`).** Жалоба: увед приходит через 1–2 часа с временем, не совпадающим с выходом. Причина — ЮKassa шлёт `payment.canceled` неоплаченного заказа с задержкой (это её механика, не баг); `Время` = `created_at` = момент НАЧАЛА оплаты (корректно). Сообщение переписано: подпись «Начал оплату: …», убрано неверное «за 10 минут», добавлено пояснение про задержку 1–2 ч; добавлен guard — если у юзера уже есть активная подписка (оплатил со второй попытки), «не завершён» не шлём.
  - **Деплой.** `db.init()` гоняет весь `schema.sql` при каждом старте (`server/src/index.js`) → новые колонки и бэкофиллы применяются автоматически, отдельный `npm run migrate` не обязателен. **Бот должен быть админом обязательного канала** и `REQUIRED_CHANNEL_ID` — числовой `-100…` (для матчинга `chat_member`), иначе выход из канала и «живой» счётчик подписчиков работать не будут.
  - В публичный `CHANGELOG.md` не выносится (правки админки/сервера, пользователи их не видят).

- **Поправка №39 — 2026-06-19 (динамические напоминания о еде: по 50 текстов на приём + подстановки из БД + редактирование в админке)**:
  - **Контекст.** Напоминания о завтраке/обеде/ужине были тремя жёстко зашитыми текстами (`MEAL_REMINDERS` в notifications.js) — одинаковые каждый день. Сделали по 50 вариантов на приём, с чередованием без повторов и подстановкой данных пользователя из БД — по той же схеме, что напоминания о подписке (тексты в `app_settings`, правятся в админке).
  - **`server/src/utils/settings.js`.** Новый ключ `meal_reminders` в DEFAULTS: `{ enabled, breakfast_hour:9, lunch_hour:14, dinner_hour:19, texts:{ breakfast[50], lunch[50], dinner[50] } }`. Плейсхолдеры: `{name} {daily_calories} {calories_today} {calories_left} {streak} {days_tracked} {meals_count} {weight_delta}`. В каждом приёме ~18 текстов БЕЗ подстановок — чтобы новичку без статистики всегда что-то ушло (renderTemplate пропускает шаблон, если данных для плейсхолдера нет).
  - **`server/src/jobs/subscriptionReminders.js`.** В экспорт `_internal` добавлен `loadPersonalStats` (переиспользуется в напоминаниях о еде вместе с `renderTemplate`/`pickTemplate`).
  - **`server/src/jobs/notifications.js`.** `MEAL_REMINDERS` удалён. `loadMealConfig()` — конфиг поверх дефолтов (как `loadConfig` подписочных), карта `час→приём` из настроек. `loadMealStats(userId,tz,dailyCalories)` — `calories_today` (SUM scans за сегодня в tz), `calories_left` (цель − съедено, null если ≤0 или нет цели), `streak` (подряд идущие дни от последней записи, активна если последняя сегодня/вчера; null если 0). `mealReminders()` переписан: фильтры прежние (`notifications_enabled/is_blocked/tg_unreachable/app_opened`), в SQL добавлены `name`/`daily_calories`, текст = `pickTemplate(cfg.texts[meal], userId, new Date().getDate(), data)` (вариант крутится по дню месяца). Новая `sendTestMealReminder({meal,user})` для кнопки «Проверить на себе».
  - **`server/src/routes/admin.js`.** В `allowed` (PUT /settings) добавлен `meal_reminders`. Новый роут `POST /reminders/meal-test` (`MEAL_KINDS=[breakfast,lunch,dinner]`) → `sendTestMealReminder` (без кнопки оплаты).
  - **Админка.** `admin/src/api.js`: `testMealReminder(meal)`. `admin/src/pages/Settings.jsx`: `MEAL_GROUPS`, компоненты `MealRemindersActions` (тест себе) и `MealRemindersEditor` (вкл/выкл, 3 часа, тексты по приёмам с подсказкой плейсхолдеров); раздел показан на вкладке «Напоминания» под подписочным; в init/`save()`/payload добавлен `meal_reminders` (чистка текстов + валидация часов 0–23).
  - **Проверка.** Автономный прогон `pickTemplate` (без БД): по 50 текстов на приём, новичку (все данные null) во все 31 день месяца уходит текст без подстановок (0 пустых/с остаточными `{}`), варианты чередуются по дням.
  - Публичный пост — в `CHANGELOG.md` (пользователи видят разнообразные персональные напоминания).

- **Поправка №38 — 2026-06-15 (бот поддержки: единый номер тикета везде)**:
  - **Контекст.** Несостыковка: карточка тикета и сообщение пользователю при создании показывали публичный `ticket_no` (случайный 6-значный, напр. №971841), а служебные сообщения админу и сообщение пользователю при ЗАКРЫТИИ — внутренний серийный `id` (№4). Для одного тикета крутились два номера; пользователь видел «Обращение №971841 принято», затем «Обращение №4 закрыто».
  - **Фикс.** `support/src/handlers/admin.js`: все ОТОБРАЖАЕМЫЕ номера переведены на `ticket.ticket_no ?? ticket.id` (fallback на `id` для старых тикетов без `ticket_no`): промпт «Напишите ответ для тикета №…» (`onReplyBtn`), закрытие — сообщение пользователю + уведомление админам + ответ боту (`onCloseBtn`), «⚠️ уже закрыт» и «✅ Отправлено в тикет №…» + уведомление (`onMessage`). Внутренние поиски и `callback_data` (`reply:`/`close:`) по-прежнему по `id` — не отображаются, менять не нужно.
  - `getTicket` уже `SELECT *`, так что `ticket_no` доступен. Карточка (`cards.js:29`) и сообщения пользователю в `user.js` уже использовали `ticket_no` — не трогались.
  - В публичный `CHANGELOG.md` не выносится (правка бота поддержки/админки).

- **Поправка №37 — 2026-06-15 (норма КБЖУ зависит от целевого веса; 5-уровневая шкала активности; авто-направление цели; ручной ввод КБЖУ)**:
  - **Контекст.** Жалоба пользователя: смена целевого веса 45→50 кг не меняла дневную норму калорий. Аудит расчёта выявил ещё три проблемы: грубая 3-уровневая шкала активности (3 тренировки = «не очень активно»), рассинхрон полей `activity` и `workouts_per_week`, и будущее противоречие `goal` ↔ `target_weight`. Чиним пакетом + добавляем ручной ввод нормы (по умолчанию — авто-расчёт).
  - **A. Целевой вес влияет на норму.** `server/src/utils/calories.js`: `calcDailyNorms` теперь считает BMR от ЦЕЛЕВОГО веса (`effectiveWeight = Number(target_weight) || Number(weight)` — fallback на текущий для старых профилей). Это «метод целевого веса»: 45 кг → ниже калорий, 50 кг → выше. Проверено: при равных данных (female,30,165,60,3 трен) цель 45→1514 ккал, 50→1591, 60(=текущий)→2046.
  - **B. 5-уровневая шкала активности.** Там же: `ACTIVITY_FACTORS` расширен до `sedentary 1.2 / light 1.375 / moderate 1.55 / high 1.725 / very_high 1.9` (легаси-ключ `low`→1.2 сохранён). Новые `activityLevelFromWorkouts(n)` (0→sedentary, 1–2→light, 3–4→moderate, 5–6→high, 7+→very_high) и `activityFactorFromWorkouts(workouts, fallbackActivity)`. Тренировки в неделю — единый источник активности.
  - **C. Авто-направление цели.** Там же: `deriveGoal(weight, target_weight)` → `loss` при `target<weight-1`, `gain` при `target>weight+1`, иначе `maintain` (допуск ~1 кг). `GOAL_DELTAS` смягчён до `loss −300 / maintain 0 / gain +300` (сам целевой вес уже создаёт дефицит/профицит). Защитный минимум калорий `Math.max(..., gender==='male'?1500:1200)`.
  - **D. profile.js (`PATCH /`).** `server/src/routes/profile.js`: удалена старая ветка вывода активности (`n<=1?low:...`); теперь `merged.activity = activityLevelFromWorkouts(wpw)`, `merged.goal = deriveGoal(mergedWeight, mergedTarget)` (оба — производные, пишутся в БД, чтобы UI не противоречил). Условие авто-пересчёта: `if (!u.goals_set_by_trainer && !u.goals_set_manually)`.
  - **E. Эндпоинты ручной нормы.** `server/src/routes/profile.js`: `PATCH /api/profile/goals` `{daily_calories,daily_protein,daily_fat,daily_carbs}` → пишет значения + `goals_set_manually=TRUE` (403 если `goals_set_by_trainer`; калории обязательны); `POST /api/profile/goals/auto` → `goals_set_manually=FALSE` + пересчёт `calcDailyNorms(u)`. Оба возвращают `publicUser`. Логируется `goal_update {by:'self'|'auto'}`.
  - **F. stats.js.** `server/src/routes/stats.js`: `maintenanceTdee` теперь `activityFactorFromWorkouts(u.workouts_per_week, u.activity)` вместо `ACTIVITY_FACTORS[u.activity]` (единый источник). Вес для расхода остаётся текущим.
  - **G. БД.** `server/src/db/schema.sql`: добавлена колонка `goals_set_manually BOOLEAN DEFAULT FALSE` (в `CREATE TABLE users` и idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS`). Колонка `activity` (TEXT) принимает 5 новых значений без миграции.
  - **H. Клиент — API.** `client/src/api/index.js`: `Profile.setGoals(body)` → `PATCH /profile/goals`; `Profile.autoGoals()` → `POST /profile/goals/auto`.
  - **I. Клиент — Profile.jsx.** `client/src/pages/Profile.jsx`: строка «Активность» теперь открывает stepper «Тренировок в неделю» (`editWorkouts`, 0–14, пишет `workouts_per_week`); value = `${wpw} трен/нед · ${level}`. `ACTIVITY_LABEL` → 5 значений. «Цель» стала read-only (производная). Новая секция «Норма КБЖУ» с компонентом `GoalsEditor` (custom-шит): 4 поля предзаполнены текущими `daily_*`, кнопка «Сохранить» (`setGoals`), при `goals_set_manually` — «Вернуть автоматический расчёт» (`autoGoals`). Для клиента тренера — info-шит «Норму задаёт тренер».
  - **J. Клиент — Onboarding.jsx.** `client/src/pages/Onboarding.jsx`: удалён шаг «Ваша цель» и `goal` из payload (направление выводится сервером из весов). Шаг «Как часто ходите в зал?» остаётся.
  - **K. Одноразовый пересчёт для существующих пользователей.** `server/src/db/recalc-norms.js` + npm-скрипт `recalc` (`node src/db/recalc-norms.js`). Проходит по всем `users`: всем обновляет производные `activity`/`goal`; `daily_*` пересчитывает только при `!goals_set_by_trainer && !goals_set_manually`. Запускать ОДИН раз после `npm run migrate` на деплое — иначе у старых юзеров норма обновится лишь при следующем `PATCH /profile`.
  - ⚠️ После B/C старые пользователи, вручную ставившие `activity`≠выводу из тренировок, получат уровень по числу тренировок (единый источник).

- **Поправка №36 — 2026-06-14 (фикс пейволла для подписчиков + контекстный текст + видимость кнопки «Позже»; селектор срока выдачи в админке; авто-подпись периода тарифа; точнее распознавание блюда; удаление мёртвого кода)**:
  - **Контекст.** Баг: у пользователя с активным доступом (своя подписка ИЛИ доступ от тренера) экран `/paywall` всё равно всплывал; текст «Бесплатный период закончился» показывался всегда; кнопка «Позже» сливалась со светлым фоном. Плюс из фидбэка владельца: срок ручной выдачи подписки не выбирался, лишнее поле «Подпись периода» в тарифах, ИИ иногда называл не ту еду.
  - **A. Различение «триал истёк» vs «подписка истекла».** `server/src/routes/profile.js` (`GET /`): добавлен запрос последней подписки любого статуса (`SELECT type,status,expires_at … ORDER BY expires_at DESC LIMIT 1`) → новое поле ответа `last_subscription` (`{type,status,expires_at}` | `null`). Клиент по нему понимает, была ли вообще платная подписка.
  - **B. Пейволл.** `client/src/pages/Paywall.jsx`: подключён `profile`; `useEffect` редиректит в `/subscription` при `profile.subscription || profile.trainer` (доступ уже есть — апселл не показываем; активный триал НЕ редиректим). Подзаголовок по ситуации: `last_subscription` → «Подписка закончилась. Продлите…»; иначе `!trial.active` → «Пробный период закончился. Оформите…»; иначе нейтральный `cfg.paywall_text`. Ранний `return null` на время редиректа. Тон «вы».
  - **C. Маршрутизация в профиле.** `client/src/pages/Profile.jsx`: `isPro` теперь учитывает доступ от тренера (`myTrainer`) → клиент тренера ведётся в `/subscription`, а не на `/paywall`; `subLabel` и бейдж показывают «Доступ от тренера»/«От тренера».
  - **D. Ссылка из бота.** `client/src/App.jsx` (эффект `startapp=paywall`): при `profile.subscription || profile.trainer` → `/subscription`, иначе `/paywall`.
  - **E. Кнопка «Позже».** `client/src/App.css`: новая переменная `--border-strong` (light `rgba(20,20,40,.16)`, dark `rgba(255,255,255,.18)`); `.sheet-btn.ghost` получил `border:1.5px solid var(--border-strong)` (видна на светлом фоне; затрагивает все ghost-кнопки — «Позже», «Я подписался», «Написать в поддержку», «Это не то»).
  - **F. Экран управления для клиентов тренера.** `client/src/pages/ManageSubscription.jsx`: статус «Доступ от тренера» / «Доступ открыт тренером» вместо «Подписки нет» / «Bytwise Free».
  - **G. Тон и дефолт текста.** `server/src/utils/settings.js` и `server/src/db/schema.sql`: дефолт `paywall_text` → нейтральный на «вы» («Оформите Bytwise PRO: безлимит фото-сканов, AI-добавление текстом и полная статистика»). ⚠️ На проде значение уже лежит в БД (старый «ты»-текст) — обновить в админке для нейтрального случая. Тексты «истёк/закончилась» зашиты в коде Paywall, от БД не зависят.
  - **H. Селектор срока выдачи (админка).** `admin/src/lib.jsx`: новые `GRANT_PERIODS` (30/90/180/365) и `periodLabel(days)`. `admin/src/pages/Users.jsx`: вместо фикс-кнопок «+PRO 30д» / «+Тренерская» — переключатель типа (PRO/Тренерская) + период + «Выдать» через `Admin.grantSub(id, askGrantBody(type, days, price))` (роут уже принимал любой `days`). Удалён роут `PATCH /users/:id/trainer` (`server/src/routes/admin.js`) и метод `makeTrainer` в `admin/src/api.js` и `client/src/api/index.js`; `client/src/pages/Admin.jsx` «+Trainer» переведён на `grantSub({type:'trainer',days:365})`.
  - **I. Тарифы — авто-подпись периода.** `admin/src/pages/Settings.jsx`: удалено ручное поле «Подпись периода»; `period` выводится из `duration_days` через `periodLabel` (пресеты, ручной ввод дней, `cleanTariffs` при сохранении).
  - **J. Распознавание блюда.** `server/src/services/openai.js` `IMAGE_PROMPT`: добавлен явный шаг опознания блюда по видимым признакам (цвет/форма/текстура/ингредиенты), запрет подгонять под «типичное», верное обобщённое название при сомнении, `confidence:"high"` только при уверенности И в названии, И в массе. `client/src/lib/image.js`: `downscaleImage` maxSize 1280→1536, quality 0.8→0.82.
  - **K. Мёртвый код.** Удалены `client/src/pages/ManualEntry.jsx`, `client/src/components/PaywallModal.jsx`, `client/src/components/ManualEntryForm.jsx` (не в роутах; реальное добавление текстом — `client/src/ui/addByText.jsx`); убран неиспользуемый `Scan.manual` из `client/src/api/index.js` (серверный роут `/scan/manual` оставлен).

- **Поправка №35 — 2026-06-14 (пакет доработок: номера тикетов, real-time админка, логи в канал, настройки, экран подписки, фиксы статистики и тренерской ссылки)**:
  - **Контекст.** Пакет фидбэка от владельца: непорядковые номера тикетов; данные админки в реальном
    времени; перестановка тарифов и удобные периоды; дублирование событий в Telegram-канал
    `-1004283676399`; целые числа в статистике; фикс дубля тренерской ссылки; полноценный экран
    «Управление подпиской»; всё динамично через админку.
  - **A. Статистика — целые числа.** `routes/stats.js`: `mealsPerDay = Math.round(totalMeals / nDays)`
    (было `*10/10` → «2.9 / 3.4 приёма в день»). Подпись в `admin/src/pages/Users.jsx` уточнена на
    «Б/Ж/У (среднее за приём)».
  - **B. Дубль тренерской ссылки.** `routes/trainer.js`: из `share_text` убрана сама ссылка — Telegram
    `t.me/share/url?url=…&text=…` (см. `client/src/pages/Trainer.jsx`) уже подставляет её из `url=`,
    из-за чего ссылка печаталась дважды.
  - **C. Номер тикета — случайный 6-значный.** Колонка `support_tickets.ticket_no` + UNIQUE-индекс
    `uniq_support_ticket_no` + бэкфилл `100000+(id*73 % 900000)` (биекция → без коллизий) — в ОБОИХ
    схемах (`server/src/db/schema.sql`, `support/src/schema.sql`). Генерация при создании тикета
    (`support/src/handlers/user.js` `findOrCreateTicket`: random 100000–999999, ретрай при 23505 по
    `err.constraint === 'uniq_support_ticket_no'`; гонка по open-per-user обрабатывается как раньше).
    Отображение `№ticket_no` в боте (`cards.js`, `handlers/user.js`), в админке (`Support.jsx`,
    `SupportTicket.jsx`) и в сообщениях `routes/admin.js` (ответ/закрытие). Внутренний `id` остаётся
    ключом и для роутинга/запросов.
  - **D. Real-time админка.** `admin/src/lib.jsx`: `useFetch(fn, deps, { intervalMs })` — тихий reload
    (без `loading`, пауза при `document.hidden`), возвращает `lastUpdated`. `LiveProvider`/`useLive`:
    интервал из `admin_live_refresh_sec` (деф. 10, мин. 3 c, 0 — выкл), пауза/возобновление. Индикатор
    в `components/Layout.jsx`. Подключено: Dashboard, Users(список), Subscriptions, Finance(3 запроса),
    Scans, Support, SupportTicket, Logs. Провайдер обёрнут вокруг `Layout` в `App.jsx`.
  - **E. Настройки (UX + периоды + перестановка).** `admin/src/pages/Settings.jsx`: в `TariffCard`
    кнопки ↑/↓ (перестановка = порядок показа в пейволле), пресеты периода (Месяц/3 мес/6 мес/Год →
    `duration_days`+`period` одной кнопкой), ручные поля сохранены. Новая вкладка «Логи в Telegram»
    (`TgLogEditor`): мастер-тумблер, id канала, тумблеры событий, поле `admin_live_refresh_sec`.
    Новые ключи в `allowed` (`routes/admin.js` PUT /settings) и в `utils/settings.js` DEFAULTS.
  - **F. Логи в Telegram-канал.** Новый `services/channelLog.js` (`post`/`postPhoto`/`logError`/`esc`,
    читает `tg_log_enabled`/`tg_log_channel_id`/`tg_log_events`, всё fire-and-forget). Хуки: `notify.js`
    (users/payments — тот же текст, что админам), `routes/scan.js` (фото-скан → `postPhoto` URL
    `${SERVER_URL}/uploads/...`, только `source='photo'`; + `logError` на сбоях AI), `app.js`
    (error-handler ≥500 → `logError`), `routes/admin.js` (ручная выдача подписки). Поддержка:
    `support/src/channelLog.js` постит основным ботом (`new Telegram(TELEGRAM_BOT_TOKEN)`), канал/тумблер
    читает из общей `app_settings`; хук в `support/src/handlers/user.js`. Требует
    `TELEGRAM_BOT_TOKEN` в `support/.env` (опционально, graceful).
  - **G. Логи в админке понятным языком.** `admin/src/pages/Logs.jsx`: `describe(action, details)` →
    фраза вместо JSON, иконки/цвет пилюль по типу, автообновление. Сырой JSON — в `title` (hover).
  - **H. Экран «Управление подпиской».** Новый `client/src/pages/ManageSubscription.jsx` (маршрут
    `/subscription` в `App.jsx`): статус + дней осталось + прогресс-бар; смена/улучшение тарифа
    (basic→trainer, триал→любой; через `Subscription.buy`); история платежей. Новый эндпоинт
    `GET /api/subscription/payments` (`routes/subscription.js`), `Subscription.payments` в `api/index.js`.
    `client/src/pages/Profile.jsx`: `openSubscription` ведёт на `/subscription` (раньше — инфо-шит → paywall).
  - **I. Без хардкода.** channel id, тумблеры событий и интервал автообновления — в `app_settings`,
    редактируются в админке.
  - **Проверка.** `npm run build` admin/client — ок; `jest` server 34/34; `vitest` client 5/5;
    `node --check` всех изменённых server/support файлов — ок.

- **Поправка №34 — 2026-06-12 (карточка «Действия» разделена на два блока)**:
  - **Контекст.** Владелец не понял, что выпадающий список типов относится только к «Проверить на себе»,
    и решил, что для рассылки всем нужно что-то выбирать.
  - `admin/src/pages/Settings.jsx`, `RemindersActions`: карточка разделена на два подписанных блока
    с разделителем — **«Рассылка всем клиентам»** (только кнопка, переименована в «📨 Разослать всем
    сейчас», пояснение «каждому по его ситуации, не чаще 1/сутки») и **«Проверка на себе»**
    (select + кнопка, пояснение «придёт только вам, на рассылку всем выбор не влияет»).
    Логика не менялась, только разметка/тексты. esbuild-парс ок.

- **Поправка №33 — 2026-06-12 («Разослать сейчас» = blast по текущей стадии каждого + фикс бага текстов триала)**:
  - **Контекст.** Владелец хочет, чтобы «Разослать сейчас» отправляла каждому клиенту сообщение по его
    ТЕКУЩЕЙ ситуации, а не только тем, у кого сегодня точное совпадение с расписанием (иначе истёкшие
    давно — например 20 дней назад — не получают ничего). Попутно найден и исправлен баг №31.
  - **БАГ (был в проде с №31):** для стадий триала `classify` возвращал `kind='trial'`, а тексты
    искались по `cfg.texts[plan.kind]` — ключа `trial` в настройках нет (есть `trial_start`/`trial_end`),
    то есть сообщения «первый/последний день пробного» никогда не отправлялись (стадия съедалась
    дедупом, с №32 — с warn в логе). Фикс: `classify`/`classifyBlast` возвращают отдельный
    **`textsKey`**, выбор шаблона — `pickTemplate(cfg.texts[plan.textsKey], …)`. Тест на это добавлен
    (textsKey для всех пяти веток).
  - **Blast-режим** (`jobs/subscriptionReminders.js`): `subscriptionReminders({ force, blast })`;
    новая `classifyBlast(row, cfg, trialDays, today)` — без сверки с расписанием: активная подписка
    и до конца ≤ max(paid_pre_days) → paid_pre (days_left фактический), истекла (любой давности) →
    paid_post; триал: идёт → trial_start, последний день → trial_end, кончился (любой давности) →
    trial_post; клиент активного тренера / cancelled-с-будущей-датой / до конца дальше горизонта — skip.
    Дедуп blast: `kind='manual_<тип>'`, `stage=YYYY-MM-DD` — повторное нажатие в тот же день не дублит,
    завтра можно снова. Вариант текста — ротация по дню месяца.
  - **Предохранитель «1 в сутки»**: в основной SQL добавлен EXISTS `reminded_recently`
    (`subscription_reminders.sent_at > NOW() - INTERVAL '20 hours'`) — действует в ОБОИХ режимах:
    blast и вечерний крон не приходят в один день (пропущенная из-за этого плановая стадия не
    переносится — человек уже получил напоминание в этот день).
  - **`routes/admin.js`**: `POST /reminders/run` → `{ force: true, blast: true }`.
    `admin/src/pages/Settings.jsx`: текст confirm и расшифровка «пропущено» обновлены под blast.
  - **Надёжность**: max по спискам дней через `Math.max(...)` вместо «последний элемент»
    (не полагаемся на сортировку). Мини-тесты расширены до 47 (textsKey всех веток, 8 кейсов blast,
    границы горизонта) — 47/47.

- **Поправка №32 — 2026-06-12 (кнопки «Разослать сейчас» / «Проверить на себе» + вкладки в настройках админки)**:
  - **Контекст.** После деплоя №31 владелец ожидал мгновенной рассылки напоминаний — а они уходят
    кроном раз в час (минута :05) и только тем, у кого локально «час отправки» (деф. 19:00).
    Добавлены ручной запуск из админки и тест на себе; страница «Настройки» переведена с длинной
    портянки на вкладки.
  - **Job `jobs/subscriptionReminders.js`**: сигнатура `subscriptionReminders({ force = false } = {})`
    (`forceRun = force || env REMINDER_FORCE` — обходит ТОЛЬКО фильтр локального часа, дедуп работает);
    теперь возвращает статистику `{ sent, failed, blocked, skipped, total }`, при выключенной системе —
    `{ disabled: true, … }`. Новая `sendTestReminder({ kind, user })` (экспорт): тексты/кнопка из боевого
    конфига, личные цифры из `loadPersonalStats` админа, недостающие — образцы (47 приёмов, 12 дней,
    «−2,5 кг», days_left 3, expires_date = сегодня+3), случайный stageIndex (каждый клик — другой вариант),
    префикс «🧪 Тест — так это увидит пользователь:», та же inline-кнопка `startapp=paywall`.
  - **Роуты `routes/admin.js`** (под adminAuth, блок «НАПОМИНАНИЯ О ПОДПИСКЕ» перед «ПОДДЕРЖКА»):
    `POST /admin/reminders/run` → `subscriptionReminders({ force: true })` → logAction + счётчики в ответ,
    при disabled → `{ ok: false, disabled: true }`; `POST /admin/reminders/test { kind }` → валидация по
    `REMINDER_KINDS`, юзер-строка админа по `req.admin.id`, ответы-ошибки: `bad_kind` (400),
    `admin_user_not_found` (404), `no_templates`, `mock_mode`, `bot_not_started` (403 от Telegram),
    `send_failed`.
  - **API-клиент `admin/src/api.js`**: `Admin.runReminders()`, `Admin.testReminder(kind)`.
  - **`admin/src/pages/Settings.jsx`**: вкладки `TABS` (tariffs/limits/texts/reminders/security,
    `useState("tariffs")`, паттерн кнопок периодов из Finance.jsx — `btn sm` + `ghost`); форма общая,
    переключение не теряет правки; кнопка «Сохранить настройки» на всех вкладках кроме «Безопасность»
    (payload сохраняет всё разом, как раньше); `<Security />` — отдельная вкладка. Новый компонент
    `RemindersActions` (карточка «Действия» наверху вкладки «Напоминания»): «📨 Разослать сейчас» с
    `window.confirm` (предупреждение про несохранённые изменения и отсутствие повторов) и итогом
    «отправлено/недоступны/пропущено»; «🧪 Проверить на себе» с select по `REMINDER_GROUPS` и
    разбором ошибок (bot_not_started/no_templates/mock_mode).
  - **Проверка**: `node --check` (subscriptionReminders, admin, notifications), esbuild-парс
    Settings.jsx/api.js, мини-тест логики — 32/32. CHANGELOG.md не трогаем (изменения только в админке).

- **Поправка №31 — 2026-06-12 (напоминания о подписке/триале + тренерский тариф на Paywall + апгрейд basic→trainer + даты окончания в админке)**:
  - **Контекст.** Раньше было одно напоминание (за 3 дня до конца подписки, `0 11 * * *`, всем сразу),
    после истечения — тишина. Тренерский тариф был скрыт с Paywall. Теперь: серия «дожимающих»
    напоминаний до/после окончания подписки и пробного периода с кнопкой «Продлить» и личными цифрами,
    всё настраивается из админки; Paywall показывает оба тарифа; разрешён апгрейд basic→trainer;
    в админке у пользователей видны даты окончания подписки/пробника.
  - **Новый job `server/src/jobs/subscriptionReminders.js`** (cron `5 * * * *` в `notifications.js`;
    старый `subscriptionReminder()` и его `0 11 * * *` удалены). Алгоритм: один SQL выбирает юзеров
    с локальным часом = `send_hour` (паттерн mealReminders, `COALESCE(timezone,'Europe/Moscow')`),
    LATERAL — последняя подписка (`ORDER BY expires_at DESC LIMIT 1`), EXISTS — клиент активного
    тренера (пропускается), разницы дат в tz юзера. Классификация (`classify`): активная подписка и
    дней до конца ∈ `paid_pre_days` → `paid_pre d{n}` (cancelled с будущей датой — пропуск, это
    ручной отзыв админом); истекла и diff ∈ `post_days` → `paid_post p{n}`, дальше — никогда;
    подписок не было → триал от `COALESCE(trial_started_at, created_at)` по календарным дням в tz:
    дни 0–1 → `trial start` (окно-догонялка), день `trial_days−1` → `trial end`, после — `trial_post p{n}`
    (p0 = первый день без доступа). Фильтры: `NOT is_blocked AND NOT tg_unreachable AND app_opened`;
    **`notifications_enabled` сознательно игнорируется**. 403 → `tg_unreachable=TRUE`.
    Кнопка: `reply_markup.inline_keyboard` url `https://t.me/<TELEGRAM_BOT_USERNAME>?startapp=paywall`.
    `REMINDER_FORCE=1` — прогон без фильтра по часу. Экспорт `_internal` (classify/renderTemplate/
    pickTemplate/toDayList/formatWeightDelta) для тестов без БД.
  - **Дедуп**: таблица `subscription_reminders` в `schema.sql` (user_id, kind, stage, anchor_at,
    sent_at, `UNIQUE(user_id,kind,stage,anchor_at)`); anchor = `expires_at` подписки или
    `trial_started_at` — продление даёт новый anchor и серия сбрасывается. Вставка ДО отправки
    `INSERT … ON CONFLICT DO NOTHING RETURNING id` — одна попытка на стадию.
  - **Настройка `app_settings.reminders`** (дефолты в `utils/settings.js DEFAULTS`): `{ enabled,
    send_hour:19, paid_pre_days:[7,3,1], post_days:[0,1,3,7,14], button_text, texts:{trial_start,
    trial_end, trial_post, paid_pre, paid_post} }` — по 10–12 русских шаблонов на контекст.
    Плейсхолдеры `{name} {meals_count} {days_tracked} {weight_delta} {days_left} {expires_date}
    {trial_days}`; `renderTemplate` возвращает null при отсутствии данных → берётся следующий шаблон;
    выбор детерминированный `(user_id+stageIndex) % N` по кругу. `{weight_delta}` — первый vs последний
    `weight_history`, показывается при |Δ|≥0.3 (явная проверка на null: `Number(null)===0`).
    `loadConfig()` мержит сохранённое поверх DEFAULTS — частичный/битый объект не роняет job.
  - **Админка**: `routes/admin.js` — ключ `reminders` в белый список `PUT /settings`;
    `admin/src/pages/Settings.jsx` переструктурирована в подпункты «Тарифы и цены», «Пробный период
    и лимиты», «Тексты приложения», «Напоминания о подписке» (новый `RemindersEditor`: выключатель,
    час, списки дней строкой «7, 3, 1» → числа при сохранении, текст кнопки, 5 раскрывающихся блоков
    текстов с подсказкой по плейсхолдерам); один общий «Сохранить настройки».
  - **Даты окончания в админке**: `GET /admin/users` теперь отдаёт `sub_expires_at` (подзапрос
    expires_at активной подписки) и `trial_ends_at` (`trial_started_at + make_interval(days=>trial_days)`);
    `GET /admin/users/:id` — `trial_ends_at` (как в checkLimit.js). `admin/src/pages/Users.jsx`:
    в колонке «Подписка» новый `SubCell` — под бейджем «до 12.07.2026» / «пробник до …» /
    «пробник истёк …»; в карточке пользователя пилюля «пробный до/истёк …» когда подписок не было.
  - **Paywall и апгрейд**: `client/src/pages/Paywall.jsx` — убран фильтр `t.id !== "trainer"`,
    показываются все включённые тарифы. `routes/subscription.js /buy` — 409 `already_subscribed`
    теперь НЕ срабатывает для `active.type==='basic' && type==='trainer'` (апгрейд за полную цену;
    `fulfillPayment` без изменений гасит basic и создаёт trainer на 30 дней — работает и через
    вебхук, type/duration из metadata). «Стать тренером» в Профиле и `BecomeTrainer.jsx` не тронуты.
  - **Deep link**: `client/src/App.jsx` — новый эффект `paywallHandled`: `start_param === "paywall"`
    (или `?startapp=paywall`) → `navigate("/paywall")` один раз за сессию, после онбординга.
  - **Проверка**: `node --check` всех изменённых server-файлов; esbuild-парс 4 JSX; мини-тест логики
    без БД (32 проверки: все стадии pre/post/trial, границы серии, клиент тренера, ротация шаблонов,
    пропуск шаблонов без данных, weight_delta) — нашёл и исправил баг `Number(null)===0` в
    `formatWeightDelta`. На проде после деплоя: `npm run migrate` создаст таблицу автоматически
    (schema.sql идемпотентен), вручную проверить `REMINDER_FORCE=1` прогон и ссылку
    `t.me/Bytwise_bot?startapp=paywall`.

- **Поправка №30 — 2026-06-12 (бот техподдержки support/ + раздел «Поддержка» в админке)**:
  - **Контекст.** Отдельный бот техподдержки **@BytwiseSupport_bot** (токен в `support/.env`):
    пользователь пишет проблему (текст/фото) → тикет в общей БД → карточка всем админам с кнопками
    «✍️ Ответить» / «✅ Закрыть» → ответ доставляется пользователю. Полноценный диалог до закрытия
    тикета админом. Управление в боте — только кнопками. Плюс полноценный раздел «Поддержка»
    в веб-админке (просмотр, ответ с сайта, закрытие).
  - **Новое приложение `support/`** (Node.js, CommonJS, `telegraf@4.16`, `pg`, `dotenv`; общая БД,
    запуск независим от основного приложения): `src/index.js` (dotenv → `ensureSchema()` →
    `bot.launch()` → graceful shutdown), `config.js` (`SUPPORT_ADMIN_IDS` → массив, `isAdmin()`),
    `db.js` (Pool max 5), `bot.js` (роутинг апдейтов admin/user, `bot.catch`), `cards.js`
    (HTML-карточка тикета + данные из `users`, `sendLong` — резка по 4096, `sendCardToAdmin` —
    фото с caption ≤ 1024), `handlers/user.js` (поиск/создание тикета, retry при 23505),
    `handlers/admin.js` (in-memory `pending: Map<adminId, ticketId>`, `/cancel`, ответ с обработкой
    403 «заблокировал бота» — пишем в БД с пометкой, атомарное закрытие
    `UPDATE … WHERE status='open' RETURNING`, кросс-уведомления остальным админам).
  - **БД**: таблицы `support_tickets` (user_id = **telegram_id** BIGINT, username/user_name на момент
    обращения, status open/closed, subject, closed_at/closed_by) и `support_messages` (sender
    user/admin, via bot/web, text, photo_file_id). Частичный UNIQUE `uniq_support_open_per_user` —
    один открытый тикет на пользователя + защита от гонки. DDL в `server/src/db/schema.sql`
    (источник правды) и **копия** в `support/src/schema.sql` (бот применяет на старте, чтобы не
    зависеть от `npm run migrate`) — при правке менять оба.
  - **Сервер**: новый `services/supportBot.js` (axios на Bot API с `SUPPORT_BOT_TOKEN`: `sendMessage`
    с error_code, `getFileUrl` с кэшем 30 мин, `notifyOtherAdmins`); в `routes/admin.js` блок
    «ПОДДЕРЖКА»: `GET /support/tickets?status=open|closed|all` (LEFT JOIN users, message_count,
    last_text, open_count), `GET /support/tickets/:id` (тикет + переписка, admin_name по JOIN),
    `POST /support/tickets/:id/reply` (409 ticket_closed; 403 Telegram → запись в БД +
    `warning: user_blocked_bot`; `via='web'`, logAction, нотификация остальным админам),
    `POST /support/tickets/:id/close` (атомарно, 409 already_closed), `GET /support/photo/:fileId`
    (валидация `/^[\w-]+$/`, прокси-стрим из Telegram — `<img>` не передаёт Bearer).
    В корневой `.env` и `server/.env.example` добавлен `SUPPORT_BOT_TOKEN`.
  - **Админка**: `api.js` — блок `Support` (tickets/ticket/reply/close/photoBlob с
    `responseType:"blob"`); NAV-пункт «Поддержка» (`Layout.jsx`), роуты `/support` и `/support/:id`
    (`App.jsx`); новые страницы `pages/Support.jsx` (список с фильтром статуса, бейдж открытых)
    и `pages/SupportTicket.jsx` (шапка с данными приложения, лента сообщений user/admin,
    компонент `TgPhoto` — blob → objectURL c revoke, форма ответа ≤ 4000, закрытие с confirm).
  - **Батники**: `support-start.bat` (npm install при отсутствии node_modules, окно
    «Bytwise SUPPORT») и `support-stop.bat` (taskkill по заголовку окна) — основной
    `start.bat`/`stop.bat` не тронуты.
  - **Деплой на VPS**: залить папку `support/` (с `.env`), обновлённые `server/src/`, пересобранный
    `admin/dist/`, добавить `SUPPORT_BOT_TOKEN` в корневой `.env`, перезапустить API, запустить
    `support-start.bat`. Таблицы создадутся сами при первом старте бота (или `npm run migrate`).
  - **Проверено локально**: `node --check` всех файлов, `vite build` админки, запуск бота без БД
    (понятная ошибка + exit 1), `getMe` токена (бот @BytwiseSupport_bot активен). End-to-end
    (тикет → карточка → ответ → закрытие) — проверить на VPS после выкладки.

- **Поправка №29 — 2026-06-10 (аудит на баги: initData TTL, приём пищи по поясу профиля, мелкие фиксы)**:
  - **Контекст.** Полный аудит сервера/клиента/админки на баги. Критических не найдено: вебхук ЮKassa
    перепроверяет платёж через `getPayment()` (рекомендация ЮKassa, HMAC они не дают), `fulfillPayment`
    идемпотентен (dup-check + частичный UNIQUE), backup.js обрабатывает ошибки pg_dump, restore.bat
    распаковывает архив ДО `DROP DATABASE`. Исправлены 4 некритичных недочёта.
  - **initData TTL** (`.env`): добавлен `INITDATA_MAX_AGE_SEC=3600`. Код в `services/telegram.js:35`
    переменную уже поддерживал, но без неё действовал дефолт 86400 с (24 ч) — перехваченную initData
    можно было переигрывать сутки. **На VPS добавить ту же строку в `.env` и перезапустить API** —
    локальная правка на прод не влияет.
  - **`defaultMeal(tz)`** (`client/src/ui/meal.js`): час берётся в поясе профиля через
    `Intl.DateTimeFormat(..., { timeZone: tz, hourCycle: "h23" })`, фолбэк на часы устройства при
    отсутствии tz / ошибке Intl. Раньше `new Date().getHours()` — при расхождении пояса устройства
    и профиля еда падала не в тот приём. Прокинут tz: `App.jsx` `handleCapture` →
    `defaultMeal(profile?.user?.timezone)` (+ `profile` в deps useCallback), `openAddByText(ui, onAdded, tz)`
    → `AddByTextBody({ tz })` (вызовы в `Home.jsx` передают `tz`).
  - **Гонка в статистике** (`client/src/pages/Stats.jsx`): в useEffect загрузки `Stats.get(tab)` добавлен
    флаг `alive` + cleanup — поздний ответ старого таба больше не перетирает данные нового при быстром
    переключении День/Неделя/Месяц.
  - **Кнопки рассылки** (`server/src/routes/admin.js` POST `/broadcasts`): невалидный JSON в
    `req.body.buttons` теперь возвращает `400 { error: "bad_buttons_json" }` вместо молчаливого
    `buttons = null` (рассылка уходила без кнопок, админ не знал). Фронт админки уже показывает
    `e.response.data.error` — отдельной правки не нужно.
  - **Проверено и НЕ баги** (ложные тревоги аудита): CSRF в админке (Bearer из sessionStorage),
    краш `dishes[0]` (groupScans гарантирует ≥1 блюдо), `tzLabel` (обёрнут в try/catch),
    `JSON.parse` в Settings админки (внутри try/catch save), `mealTime` без tz в Trainer.jsx
    (сервер отдаёт готовый `time_label`), пути в Caddyfile (это пути прод-VPS).
  - **Замечание без правки:** корневой `.env` с боевыми ключами (OpenAI, Telegram, ЮKassa) лежит в
    OneDrive-папке и синхронизируется в облако Microsoft. В git не попадает.
  - **Тесты:** server 34/34 (jest), client 5/5 (vitest) — зелёные.

- **Поправка №28 — 2026-06-10 (устойчивое распознавание: всегда добавляем еду, фикс `ai_parse_failed`)**:
  - **Проблема.** Все `ai_parse_failed` рождались в `services/openai.js` `finalize()` — бросалось при
    пустом/непарсящемся `dishes`. В одну ошибку валились три причины: «еды нет», обрезанный по
    `max_tokens` JSON (после №26 модель пишет длинный `analysis`), разовый сбой OpenAI (≈ «status code 500»).
  - **`callOpenAI`** (`services/openai.js`): добавлены ретраи — до 3 попыток с паузой `400·n` мс при
    сетевой ошибке / ответе OpenAI `>=500` / `429`. Снимает разовые «Request failed with status code 500».
  - **Лимит токенов** поднят: фото `1500→3000`, текст `800→1500` (при обрезке — повтор с `tokens×2`, потолок 4000).
  - **`parseDishes(content)`** (новая, экспортируется): 1) полный разбор через `extractJson`;
    2) если не вышло — регуляркой `/\{[^{}]*\}/g` вытаскиваются завершённые плоские объекты блюд и
    собираются в массив (спасение **обрезанного** ответа — уцелевшие блюда не теряются). Возвращает
    нормализованный массив (через `normalizeDish`), возможно пустой.
  - **`analyze({model,messages,maxTokens,fallbackName})`** (новая) — общий путь для
    `analyzeImage`/`analyzeText`: вызов → `parseDishes` → при пустом результате повтор (бо́льший лимит
    при `finish_reason==='length'`, иначе добавочная инструкция «верни хотя бы одно блюдо») → если и
    после повтора пусто, **`fallbackDish(name)`** (новая, экспортируется): один элемент с
    `confidence:'low'` (имя = описание пользователя для текста / «Блюдо» для фото). **Еда добавляется
    всегда**, `ai_parse_failed` наружу больше не бросается. Возвращает
    `{dishes, low_confidence, usage, model, finish_reason, fallback}`.
  - **`finalize` удалён** — заменён на `analyze`. `analyzeImage`/`analyzeText` переписаны на `analyze`.
  - **`routes/scan.js`**: на успешном пути в `aiUsage.record` пишется пометка
    `error: "fallback (finish=…)"` при `result.fallback` (для диагностики, без статуса error),
    в `logAction("scan")` добавлен флаг `fallback`. Блоки `catch` остаются как крайний случай
    (нет ключа OpenAI / полный отказ сети после ретраев). Модели в логе ошибки — `err.model`
    с фолбэком на `VISION_MODEL`/`TEXT_MODEL` (из №27).
  - **Тесты** `tests/openaiParse.test.js`: валидный JSON, мультиблюдо, спасение обрезанного JSON,
    пустой/битый → `[]`, `fallbackDish` (имя/дефолт «Блюдо», `confidence:'low'`). Всего по проекту
    34/34 зелёных.
  - Модели (`gpt-4.1`/`gpt-4.1-mini`), формат полей наружу и БД не менялись.

- **Поправка №27 — 2026-06-10 (сессия админки, воронка, кривые числа, пачка багфиксов)**:
  - **Сессия админки (вылеты).** `utils/jwt.js`: `signAdmin` дефолт `30m → 12h`. `middleware/adminAuth.js`:
    «скользящее» продление — если до `exp` осталось < 6 ч, выпускаем свежий токен и кладём в заголовок
    `X-Admin-Token`. `app.js`: `cors({ exposedHeaders: ["X-Admin-Token"] })`. `admin/src/api.js`:
    успешный перехватчик ответа читает `x-admin-token` и вызывает `setToken`. Итог: активного админа
    не выкидывает, простой 12 ч → повторный вход (sessionStorage и так чистится при закрытии браузера).
  - **Воронка «Путь клиента».** `admin/src/pages/Funnel.jsx` переписан: сводка из 3 карточек (пришло,
    конверсия в оплату, главный отвал), сужающиеся бары (ширина ∝ value/max), шаговая конверсия
    `value/prevValue` пилюлей (зелёная ≥70 / жёлтая 40-70 / красная <40), коннектор «▼ −N», золотая
    подсветка последнего шага. Классы `.funnel*`, `.fn-pill`, `.pill.amber` — в `admin/src/styles.css`.
    Сервер не менялся (данные `/admin/funnel` уже есть).
  - **K. Кривые значения статистики** (`routes/stats.js`): `meals_per_day` считался
    `totalScans / days` (все календарные дни) по строкам-блюдам → выдавал «0.1». Теперь
    `COUNT(DISTINCT COALESCE(batch_id, id::text)) / nDays` (приёмы по batch, делёж на активные дни).
    Суммы `totals` (protein/fat/carbs) округляются до 0.1 в ответе (убирает хвосты `0.30000…`).
    Тренерская статистика чинится автоматически (общий `computeStats`).
  - **A. Рассылка в фоне** (`services/broadcast.js`): `createAndSend` разбит на `createBroadcast`
    (вставляет строку, возвращает сразу) и `runBroadcast` (фоновая отправка с паузой 40 мс ≈25/сек,
    409/429 не считаются доставкой). `routes/admin.js` POST `/broadcasts` отвечает сразу, затем
    `runBroadcast(id).catch()` без await. Колонка `broadcasts.status` (pending/sending/done) в
    `schema.sql` (ADD COLUMN IF NOT EXISTS DEFAULT 'done'). `admin/src/pages/Notifications.jsx`:
    столбец «Статус» с пилюлей, кнопка «Обновить», текст «рассылка запущена».
  - **C. Единый пояс аналитики** (`routes/admin.js`): группировки по дню переведены на
    `(... AT TIME ZONE 'Asia/Yekaterinburg')::date` — графики дашборда (user/revenue/activity/scans),
    `byDay` финансов и AI, дни питания в карточке юзера, воронка «вернулись на след. день».
  - **B. EXIF-поворот фото** (`client/src/lib/image.js`): `createImageBitmap(file, { imageOrientation: "from-image" })`.
  - **D. NaN-id → 400** (`utils/http.js` `parseId`): применён в `routes/scan.js` (PATCH/DELETE),
    `routes/trainer.js` (client_id/scan_id), `routes/admin.js` (все `:id`). Было `Number(...)` → `NaN`
    в SQL → 500; стало `400 bad_id`. `track.js` уже отсекал NaN через `if (broadcastId)`.
  - **E. История — будущие дни** (`client/src/pages/History.jsx`): гашение будущих ячеек по
    `profile.server_today` (строковое сравнение) вместо локальной полуночи телефона.
  - **F. mock-confirm** (`routes/subscription.js`): `JSON.parse(req.query.meta)` в try/catch → `400 bad_meta`.
  - **G. Надёжность процесса** (`index.js`): `process.on('unhandledRejection'|'uncaughtException')` с
    логом; graceful-shutdown на SIGTERM/SIGINT (`server.close()` + `db.pool.end()`).
  - **H. Лог модели скана** (`routes/scan.js`): `process.env.OPENAI_MODEL` (не существует) → `err.model`
    с фолбэком на `VISION_MODEL`/`TEXT_MODEL` из `services/openai.js`.
  - **I. subscriptionReminder** (`jobs/notifications.js`): при `error_code===403` ставит
    `tg_unreachable=TRUE` (как `mealReminders`).
  - **J. Профиль без служебных полей** (`routes/profile.js`): `publicUser` омитит `ref_code`,
    `login_count`, `device`, `last_login_at`, `free_scans_used`, `referred_by`, `trial_started_at`,
    `tg_unreachable`, `app_opened` (клиент их не читает — проверено grep по `client/src`).
  - **Тесты:** `server` Jest — 28/28 зелёные; сборки `admin` и `client` (vite build) проходят.

- **Поправка №26 — 2026-06-09 (точность распознавания КБЖУ: пошаговое рассуждение, запрет округления)**:
  - **Проблема.** Оценки калорий часто выходили «круглыми» (300/500/700 ккал) и казались неточными:
    у модели спрашивали сразу итог, без хода рассуждений — и она называла числа «на глаз».
  - **Решение в промптах** (`services/openai.js`, `IMAGE_PROMPT` и `TEXT_PROMPT`): жёсткий порядок —
    сначала определить блюдо и **массу порции**, прикинуть реалистичную **плотность калорий (ккал/г)**,
    и только потом дать **итог именно для этой массы** (НЕ «на 100 г»). Поле `analysis` теперь обязано
    показывать ход «вес → плотность → итог»; в `TEXT_PROMPT` поле `analysis` добавлено (раньше его не было).
    Добавлен прямой **запрет округлять итог** до сотен/полусотен (например 437, а не 450) и пример-эталон.
  - **Код** (`services/openai.js`): порог расхождения калорий с макросами в `reconcileMacros` ужесточён
    25%→20% (под формулу Атуотера `protein*4+carbs*4+fat*9`). В `normalizeDish` добавлена проверка
    вменяемости: если итог даёт >9 ккал/г (физически невозможно), уверенность опускается до `low`.
  - **Надёжность ответа**: в запрос к OpenAI добавлен `response_format: { type: "json_object" }`
    (валидный JSON, меньше ошибок парсинга). Лимит токенов для текста поднят 500→800 под поле `analysis`.
  - Модель и скорость не менялись (`gpt-4.1` фото, `gpt-4.1-mini` текст). Формат полей наружу
    (`calories/protein/fat/carbs/weight_grams/confidence`) не изменился — `scan.js`, БД и клиент не трогались.

- **Поправка №25 — 2026-06-08 (уведомление админам о новом пользователе)**:
  - Когда новый человек впервые попадает в базу, всем админам (`ADMIN_TELEGRAM_IDS`)
    приходит уведомление в Telegram: «👤 Новый пользователь … нажал /start / впервые открыл
    приложение … Время: …». Имя кликабельно, если нет @username.
  - Срабатывает в двух точках: `/start` в боте (`bot.js`) и первый вход в приложение без
    `/start` (`auth.js`, ветка `wasInserted`). Только на по-настоящему новых записях
    (признак `(xmax = 0) AS inserted`), повторный `/start` уведомление не шлёт.
  - Новая функция `notify.notifyNewUser(userId, source)` (`services/notify.js`) —
    переиспользует существующие `notifyAdmins` / `userLabel` / `fmtWhen`. Вызовы
    «fire-and-forget» с `.catch`, чтобы сбой Telegram не ломал вход/`/start`.

- **Поправка №24 — 2026-06-08 (учёт нажавших /start в админке)**:
  - Раньше в таблицу «Пользователи» попадали только те, кто открыл мини-приложение
    (запись создавалась в `auth.js`). Нажавшие `/start`, но не зашедшие — нигде не считались.
  - Теперь при `/start` пользователь заводится в базе сразу (`bot.js` → `registerStartUser`,
    `INSERT ... ON CONFLICT DO NOTHING`-логика, существующих не трогает).
  - Новая колонка `users.app_opened` (БД): `FALSE` у тех, кто только нажал `/start`;
    `TRUE` ставится при первом входе в приложение (`auth.js`, обе ветки INSERT/UPDATE).
    Миграция через `ADD COLUMN DEFAULT TRUE` (бэкфилл существующих) → `SET DEFAULT FALSE`.
  - Админка: список `/api/admin/users` отдаёт `app_opened`; на странице «Пользователи»
    в колонке «Подписка» такие записи показаны как **«не открыл приложение»**.

- **Поправка №23 — 2026-06-07 (удаление рефералки, удаление клиента из списка тренера, выпил Docker, README+CHANGELOG)**:
  - **Реферальная система удалена** (бонусы/монеты/приглашения друзей — её не будет). Вырезан код:
    роут `/api/referral` (+ файл `routes/referral.js`), скидка монетами и реф-бонус в
    `routes/subscription.js` (`buy`/`fulfillPayment`, `use_coins`, `REFERRAL_PERCENT`), реф-логика в
    `routes/auth.js` (поиск реферера по `start_param`, вставки в `referrals`/`referral_balance`),
    поле `referral_balance` в `routes/profile.js`, роут `GET /admin/referrals`, реф-диплинк `?ref=`
    в `services/bot.js`, экспорт `Referral` в клиентском `api/index.js`.
  - **Что оставлено:** `ref_code` (users) и `utils/refcode.js` — это код ссылок-приглашений **тренера**.
    Таблицы `referrals`/`referral_balance` и колонка `users.referred_by` оставлены в БД как **legacy**
    (код их не пишет и не читает) — чтобы не терять исторические данные. Чистка этих строк при удалении
    аккаунта (`DELETE /admin/users/:id`) сохранена.
  - **Кабинет тренера: удаление клиента из списка.** У каждого клиента в списке (`pages/Trainer.jsx`) —
    кнопка-корзина, отвязывает клиента (с подтверждением). Бэкенд уже был
    (`DELETE /api/trainer/clients/:id`), при отвязке сбрасывается `goals_set_by_trainer=FALSE`.
  - **Docker удалён** (не используется): удалён `docker-compose.yml`, убрана подсказка «docker compose up»
    в `server/src/index.js`. PostgreSQL — только нативный (служба Windows).
  - **README переписан** начисто (чистая структура, оглавление, без Docker и рефералки); полная история
    «Поправок» вынесена в этот файл `CHANGELOG.md`.

- **Поправка №22 — 2026-06-07 (полный аудит: атомарность платежей, лимиты, безопасность, таймзоны)**:
  - **Платежи стали атомарными и идемпотентными на уровне БД.** Раньше `fulfillPayment`
    (`routes/subscription.js`) делал 5+ записей отдельными авто-коммитами и проверял дубль только
    `SELECT…succeeded`, без транзакции и без UNIQUE. При повторе/гонке вебхука ЮKassa (а вебхук ещё и
    отвечал 200 ПОСЛЕ медленных Telegram-уведомлений) возникали **двойная подписка, двойной реф-бонус,
    двойное списание монет**. Теперь: хелпер `db.withTx()` (`db/index.js`) — всё в одной транзакции;
    частичный `UNIQUE INDEX uniq_payments_succeeded_yukassa` (`schema.sql`, с предварительным дедупом
    succeeded-дублей) ловит гонку (`23505` → `return false`); `fulfillPayment` гасит прежние
    active-подписки и переводит существующий `pending`-платёж в `succeeded` (не плодит вторую строку);
    `ensureRefCode`/`notify` вынесены ЗА COMMIT (вебхук отвечает быстро → меньше повторов).
  - **Лимит считает приёмы, а не блюда.** `middleware/checkLimit.js`: фото из N блюд (один `batch_id`)
    раньше = N из дневного лимита. Теперь `COUNT(DISTINCT COALESCE(batch_id, id::text))`.
  - **Удаление аккаунта — в транзакции** (`routes/admin.js`, `DELETE /users/:id` через `withTx`).
  - **Безопасность.** IP-allowlist/rate-limit админки больше не обходятся подделкой `X-Forwarded-For`
    (`middleware/adminAuth.js` → `clientIp` использует `req.ip`). HMAC `initData` сравнивается через
    `crypto.timingSafeEqual`. Открытый редирект в `routes/track.js` закрыт. `utils/jwt.js` падает на
    старте в production без `JWT_SECRET`/`ADMIN_JWT_SECRET`. `scan.js` не отдаёт `detail` AI-ошибки.
    `.gitignore` дополнен (`.pgsuper`, `uploads/`).
  - **Таймзоны.** Метрики «за сегодня» в админке (дашборд/финансы/AI/сканы) считаются в
    `Asia/Yekaterinburg`, а не в UTC. Дефолтная дата истории клиента у тренера — в поясе клиента.
  - **Прочее.** `broadcast.js` при 403 ставит `tg_unreachable`. `PaywallModal.jsx` берёт первый НЕ
    тренерский тариф. `referral.js` чинил легаси-аккаунты без кода. `settings.js` читает и
    `SUB_PRICE_*`, и `PRICE_*`. Частичный индекс `idx_users_notify`. `.env.example` дополнен.

- **Поправка №21 — 2026-06-07 (клиент видит комментарий тренера в карточке блюда)**: тренерский
  комментарий (`scans.trainer_comment`) отображался у клиента только в карточке группового приёма
  (`openMealGroup`). Но большинство приёмов — одно блюдо = одна карточка (Поправка №20), которая
  открывается через `openMealDetail` и блок комментария не рендерила. Добавлено отображение блока
  «💬 Комментарий тренера» в `openMealDetail` (`client/src/ui/mealDetail.jsx`). Правка только на фронте.

- **Поправка №20 — 2026-06-07 (одно фото = одна карточка; редизайн экрана клиента в кабинете тренера)**:
  - **Одно фото/текст = один приём.** Добавлена колонка `scans.batch_id` (+ индекс): все блюда одного
    `POST /scan` и `POST /scan/text` получают общий `batch_id` (`crypto.randomUUID()`), ручной ввод — свой.
    Totals/stats считаются по строкам и не меняются.
  - **Группировка приёмов в клиенте.** Помощник `client/src/ui/meal.js` → `groupScans()`/`groupTitle()`
    (ключ: `batch_id || photo_path || тип+время`). Sheet `openMealGroup` в `ui/mealDetail.jsx`. История
    (`History.jsx`) и «последние» на Главной (`Home.jsx`) рендерят одну карточку на приём.
  - **Редизайн кабинета тренера, экран клиента** — переведён на дизайн-систему приложения. Мёртвые
    `ScanCard.jsx` и `TrainerComment.jsx` удалены.

- **Поправка №19 — 2026-06-06 (тренерская подписка: имя «Тренерская», рабочая реф-ссылка, защита от дублей заказов)**:
  - Тариф `trainer` переименован «С тренером» → «Тренерская» везде (дефолты/фолбэки + миграция).
  - Фикс отображения «PRO» вместо тренерской: `client/src/lib/sub.js` (`subBadge`/`subName`).
  - Кнопка «Стать тренером»/«Кабинет тренера» перенесена под «Мои данные» в `Profile.jsx`.
  - Рабочая ссылка-приглашение тренера (фикс `tr_null`): фолбэк имени бота `Bytwise_bot`, ленивая
    выдача `ref_code` (`utils/refcode.js`, `ensureRefCode`).
  - Защита от дублей заказов ЮKassa: переиспользование незавершённого заказа моложе 10 минут
    (`payments.confirmation_url`, перепроверка через `getPayment`).
  - Подробные уведомления админам простыми словами (`services/notify.js`).

- **Поправка №18 — 2026-06-06 (аудит кабинета тренера: целостность данных и таймзоны)**:
  - «Один клиент — один тренер» на уровне БД: `UNIQUE INDEX uniq_trainer_clients_client (client_id)`
    с предварительным дедупом; вставки ловят `23505`.
  - Фикс таймзоны в списке клиентов: «калории за сегодня» считаются в поясе клиента, а не UTC.

- **Поправка №17 — 2026-06-06 (полноценный кабинет тренера)**:
  - Тренерская подписка ожила: кнопка «Стать тренером» (`BecomeTrainer.jsx`, `buy('trainer')`),
    тренерский тариф скрыт из обычного Paywall.
  - Привязка клиента по ссылке (`startapp=tr_<refCode>`): роутер `routes/myTrainer.js`
    (`/api/my-trainer` accept/get/disconnect). Лимит — настройка `trainer_max_clients`.
  - Доступ от тренера: `hasEffectiveAccess` (своя подписка ИЛИ активный тренер) в `checkLimit`.
  - Кабинет (`pages/Trainer.jsx`): цели КБЖУ, дневник за дату, графики калорий/веса.
  - Контроль КБЖУ возвращается клиенту при отвязке (`goals_set_by_trainer=FALSE` во всех трёх местах).

- **2026-06-06 (управление тарифами из админки, @теги в уведомлениях, бургер-меню)**:
  - Тарифы/подписки целиком из админки, в реальном времени («Настройки → Тарифы и подписки»,
    `app_settings.tariffs`, `{id,title,price,period,duration_days,enabled,features[]}`). `getTariff`
    берёт цену и срок из тарифа; `fulfillPayment` получил `durationDays`. `settingsPublic` отдаёт
    только включённые тарифы. Кэш настроек 30→5 сек.
  - Цена больше нигде не захардкожена (`PaywallModal.jsx`/`Paywall.jsx` берут из настроек).
  - Уведомления админам — кликабельный `@username` (`userLabel` в `services/notify.js`).
  - Красивые названия тарифов в админских списках (`subLabel`, `useTariffMap`).
  - Мобильная админка — бургер-меню (`Layout.jsx` + `styles.css`).

- **2026-06-06 (live-ключи ЮKassa, гейт по каналу, выбор источника фото, фиксы статистики, мобильная админка)**:
  - ЮKassa live включена (`PAYMENTS_MODE=live`).
  - Обязательная подписка на канал: env `REQUIRED_CHANNEL_ID`/`REQUIRED_CHANNEL_URL`, `services/telegram.js`
    → `getChatMember`/`isChannelMember`, роут `GET /api/membership`, экран `SubscribeGate.jsx`,
    проверка в боте. Бот должен быть админом канала.
  - Камера: выбор «Сделать фото / Выбрать из галереи» (`TabBar.jsx`/`CameraButton.jsx`).
  - Статистика — гранулярность (`date_trunc` день/неделя/месяц, поле `granularity`), цель для БЖУ,
    фикс «приёмов пищи в день».
  - Админка на телефоне: таблицы → карточки (`styles.css`).
  - maintenance `reset-billing` (`server/scripts/maintenance.js`).
  - Уведомления по платежам + описание «Bytwise Pro»; фикс 403 ЮKassa «recurring»
    (`YUKASSA_RECURRING`, по умолчанию разовый платёж).

- **2026-06-06 (боевая оплата ЮKassa + деньги по API в админке)**:
  - Готовность к live: `.env`/`.env.example` документируют ключи; пустые => mock; `/mock-confirm` 404 вне mock.
  - Вебхук обрабатывает `payment.succeeded`/`payment.canceled`/`refund.succeeded`, всегда 200;
    `createPayment` принимает `idempotenceKey`.
  - Админка → Деньги: секция «По данным ЮKassa» (`GET /admin/finance/yukassa`,
    `listPaymentsSummary`/`listRefundsSummary`, кэш 2 мин).

- **2026-06-06 (микробаги: часовые пояса + hardening)**:
  - Стрик и достижения переведены на пояс пользователя (`services/achievements.js`, `routes/stats.js`,
    хелперы `addDays`/`localToday` в `utils/tz.js`).
  - Hardening: свежесть `initData` (`INITDATA_MAX_AGE_SEC`); 500-ошибки → `{error:"internal_error"}`;
    `rateLimit` чистит протухшие записи Map; mock-отправка в `mealReminders` = `skipped`.

- **2026-06-06 (деньги при выдаче, фикс уведомлений, maintenance-скрипт)**:
  - Деньги при ручной выдаче подписки: `record_payment` + опц. `amount` →
    `payments(status='succeeded', method='manual')`.
  - Введена колонка `users.tg_unreachable` (403 ставит её, не `is_blocked`; сбрасывается при входе).
  - Maintenance-скрипт `server/scripts/maintenance.js` (`dedupe-subs`, `dedupe-payments`,
    `backfill-manual-payments`, `reclassify-meals`, `reset-auto-blocks`, `all`).

- **2026-06-06 (восстановление из бэкапа)**: `restore.bat` — интерактивное восстановление БД из
  присланного в Telegram `.sql.gz` (авто-поиск `psql.exe`/`pg_dump.exe`).

- **2026-06-05 (авто-бэкап БД в Telegram)**: cron `0 0 * * *` (МСК) — `jobs/backup.js` делает `pg_dump`,
  жмёт в gzip и шлёт файл всем `ADMIN_TELEGRAM_IDS`. Env `PG_DUMP`. При сбое — уведомление админам.

- **2026-06-05 (легальные документы)**: Политика конфиденциальности и Условия использования переведены
  на Google Docs; ссылки в `support_links` и на экране оплаты.

- **2026-06-05 (аудит и фикс багов)**:
  - История грузила чужой день у поясов восточнее UTC (`ymd()` в `History.jsx`).
  - Вебхук ЮKassa защищён: идемпотентность `fulfillPayment` + `getPayment` перепроверка.
  - `mock-confirm` закрыт вне mock (404).
  - Админ-выдача подписки гасит прежние active-подписки.

- **2026-06-05 (точность КБЖУ, напоминания, категоризация приёмов пищи)**:
  - Фото анализирует `gpt-4.1`, текст — `gpt-4.1-mini`; серверная страховка `reconcileMacros` (правило
    Атуотера); `max_tokens` фото 1100→1500.
  - `defaultMeal()` по времени суток (`client/src/ui/meal.js`).
  - `mealReminders` логирует `sent/failed/blocked/skipped`.

- **2026-06 (пачка фиксов: время, подписки, админка, перформанс)**:
  - Время в поясе пользователя считает сервер: `time_label` в `/api/history`, `server_today` в `/api/profile`.
  - Напоминания о еде: `COALESCE(timezone,'Europe/Moscow')`.
  - Подписки: `409 already_subscribed`; `basic` → «Pro» в админке.
  - Онбординг: шаг «Желаемый вес» (`users.target_weight`).
  - Админка: фикс редиректа 401 → `/admin/login`; индексы; адаптив.

- **2026-06 (пачка фиксов по фидбеку)**: Профиль (юзернейм/аватар из Telegram, выбор пояса),
  `NumberPicker.jsx`, тосты стопкой, даунскейл фото до 1280px (`client/src/lib/image.js`) + таймаут
  скана 90с, админка во времени `Asia/Yekaterinburg`.

- **2026-06 (админка по-человечески + реальные расходы)**: вся админка на простом языке; раздел
  «Расходы на ИИ» из OpenAI Costs API (`OPENAI_ADMIN_KEY`) + курс ЦБ РФ (`openaiCosts.js`, `fx.js`).

- **2026-06 (защита админа)**: админ не может заблокировать/удалить сам себя
  (`cannot_block_self`/`cannot_delete_self`).

- **2026-06 (отказ от Docker)**: PostgreSQL переведён на нативную Windows-службу; оставлены `start.bat`/`stop.bat`.

- **2026-06**: фото через `/api/uploads` (+Caddy `/uploads/*`); mock-покупка активирует подписку без
  редиректа; `disableVerticalSwipes`; учёт `timezone` в истории/статистике/лимитах; пул БД 20,
  дашборд через `Promise.all`, `LIMIT` в истории.
