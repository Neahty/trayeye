CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  name TEXT,
  gender TEXT,                        -- male/female
  age INT,
  height INT,                         -- см
  weight NUMERIC,                     -- кг
  activity TEXT,                      -- low/moderate/high
  goal TEXT,                          -- loss/maintain/gain
  workouts_per_week INT,
  daily_calories INT,                 -- рассчитывается автоматически
  daily_protein NUMERIC,
  daily_fat NUMERIC,
  daily_carbs NUMERIC,
  goals_set_by_trainer BOOLEAN DEFAULT FALSE,
  goals_set_manually BOOLEAN DEFAULT FALSE,   -- пользователь задал норму КБЖУ вручную
  free_scans_used INT DEFAULT 0,      -- legacy, не используется для лимита
  trial_started_at TIMESTAMPTZ DEFAULT NOW(),
  ref_code TEXT UNIQUE,
  referred_by INT REFERENCES users(id),
  is_admin BOOLEAN DEFAULT FALSE,
  is_blocked BOOLEAN DEFAULT FALSE,
  notifications_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  type TEXT,                          -- basic/trainer
  status TEXT,                        -- active/cancelled/expired
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  yukassa_id TEXT,
  auto_renew BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS trainer_clients (
  trainer_id INT REFERENCES users(id),
  client_id INT REFERENCES users(id),  -- один клиент — один тренер
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (trainer_id, client_id)
);

CREATE TABLE IF NOT EXISTS scans (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  dish_name TEXT,
  calories INT,
  protein NUMERIC,
  fat NUMERIC,
  carbs NUMERIC,
  weight_grams NUMERIC,               -- вес порции в граммах
  meal_type TEXT,                     -- breakfast/lunch/dinner/snack
  is_manual BOOLEAN DEFAULT FALSE,    -- TRUE если добавлено вручную без фото
  photo_path TEXT,                    -- путь к файлу: uploads/users/{user_id}/{filename}
  trainer_comment TEXT,
  scanned_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weight_history (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  weight NUMERIC,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  amount INT,
  status TEXT,                        -- pending/succeeded/cancelled
  yukassa_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- LEGACY: реферальная система удалена из кода (Поправка №23). Таблицы referrals/referral_balance
-- и колонка users.referred_by оставлены, чтобы не терять исторические данные; код их не пишет
-- и не читает. ref_code (users) ОСТАЁТСЯ — это код ссылок-приглашений тренера.
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_id INT REFERENCES users(id),
  referred_id INT REFERENCES users(id),
  paid BOOLEAN DEFAULT FALSE,
  bonus_given BOOLEAN DEFAULT FALSE,
  bonus_amount INT,                   -- монеты начислено (legacy)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_balance (   -- legacy, не используется
  user_id INT PRIMARY KEY REFERENCES users(id),
  balance INT DEFAULT 0,
  total_earned INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS system_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  action TEXT,     -- login/scan/payment/profile_update/goal_update/trainer_action/admin_action/error
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_user_date ON scans (user_id, scanned_at);
CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions (user_id, status);
CREATE INDEX IF NOT EXISTS idx_logs_action ON system_logs (action, created_at);

-- ============================================================
--  Расширения и новые таблицы (Bytwise v2: дизайн + админка)
-- ============================================================

-- Профиль: оформление, аватар, активность для админки
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'light';
ALTER TABLE users ADD COLUMN IF NOT EXISTS accent JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS units TEXT DEFAULT 'metric';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS device TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_weight NUMERIC;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded BOOLEAN DEFAULT FALSE;
-- Пользователь задал норму КБЖУ вручную — авто-пересчёт по формуле тогда не трогает значения.
ALTER TABLE users ADD COLUMN IF NOT EXISTS goals_set_manually BOOLEAN DEFAULT FALSE;
-- Недоступность в Telegram (бот получил 403 на отправку). Отдельно от is_blocked,
-- чтобы единичный сбой доставки не блокировал вход и не отключал навсегда напоминания.
ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_unreachable BOOLEAN DEFAULT FALSE;
-- Открывал ли пользователь мини-приложение. Те, кто только нажал /start в боте,
-- заводятся со значением FALSE и в админке помечаются «не открыл приложение».
-- Хитрость: ADD COLUMN с DEFAULT TRUE выполняется лишь однажды и проставляет TRUE
-- всем уже существующим строкам (они все пришли через приложение); затем дефолт
-- меняется на FALSE, чтобы новые /start-записи попадали как «не открыл».
ALTER TABLE users ADD COLUMN IF NOT EXISTS app_opened BOOLEAN DEFAULT TRUE;
ALTER TABLE users ALTER COLUMN app_opened SET DEFAULT FALSE;

-- Членство в обязательном Telegram-канале. «Пользователь = подписчик канала»
-- (без подписки ботом пользоваться нельзя), поэтому именно по channel_member
-- считается «Всего пользователей» в админке, а лог «Новый пользователь» уходит
-- только когда channel_joined_at проставился впервые (см. services/channelMembership.js).
ALTER TABLE users ADD COLUMN IF NOT EXISTS channel_member BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS channel_joined_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS channel_left_at TIMESTAMPTZ;
-- Бэкофилл существующих: кто открывал приложение — тот уже прошёл шлагбаум подписки.
-- Срабатывает один раз (после него channel_joined_at не NULL и условие не выполняется),
-- старых пользователей не залогирует как «новых».
UPDATE users SET channel_member = TRUE, channel_joined_at = COALESCE(channel_joined_at, created_at)
 WHERE app_opened = TRUE AND channel_joined_at IS NULL;

-- Способ оплаты в платежах/подписках (для финансов админки)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method TEXT;        -- card/yukassa/referral/manual
ALTER TABLE payments ADD COLUMN IF NOT EXISTS sub_type TEXT;      -- basic/trainer
ALTER TABLE payments ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmation_url TEXT; -- ссылка оплаты ЮKassa (для переиспользования заказа в пределах 10 мин)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS method TEXT;
-- Отметка, что про окончание этой подписки уже залогировано (одно событие на подписку).
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expiry_logged_at TIMESTAMPTZ;
-- Чтобы детектор окончания не завалил канал историей при первом деплое: всё, что истекло
-- РАНЬШЕ окна детектора (2 суток), помечаем как уже залогированное. Свежие истечения (≤2 сут)
-- остаются NULL и будут пойманы джобом. Идемпотентно (после простановки условие не выполняется).
UPDATE subscriptions SET expiry_logged_at = NOW()
 WHERE expires_at < NOW() - interval '2 days' AND expiry_logged_at IS NULL;

-- Привязка скана к AI-источнику
ALTER TABLE scans ADD COLUMN IF NOT EXISTS ai_confidence TEXT;    -- high/medium/low
ALTER TABLE scans ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'photo'; -- photo/text/manual
-- Общий id «приёма пищи»: все блюда одного фото/текста делят batch_id (одно фото = одна карточка).
ALTER TABLE scans ADD COLUMN IF NOT EXISTS batch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_scans_batch ON scans (batch_id);

-- Учёт обращений к нейросети (AI-аналитика)
CREATE TABLE IF NOT EXISTS ai_usage (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  scan_id INT REFERENCES scans(id) ON DELETE SET NULL,
  kind TEXT,                          -- image/text
  model TEXT,
  prompt_tokens INT DEFAULT 0,
  completion_tokens INT DEFAULT 0,
  total_tokens INT DEFAULT 0,
  cost_usd NUMERIC(12,6) DEFAULT 0,
  latency_ms INT,
  status TEXT DEFAULT 'ok',           -- ok/error
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON ai_usage (created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage (user_id);

-- Ускорение админки: «История действий» (ORDER BY created_at DESC), финансы/подписки
-- (коррелированные подзапросы по payments.user_id), активные подписки по сроку.
CREATE INDEX IF NOT EXISTS idx_logs_created ON system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subs_user_expires ON subscriptions (user_id, status, expires_at DESC);

-- Редактируемые настройки приложения (раздел «Настройки» админки)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by INT REFERENCES users(id)
);

-- Каталог достижений
CREATE TABLE IF NOT EXISTS achievements (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  description TEXT,
  icon TEXT,
  emoji TEXT,
  color TEXT,
  category TEXT,
  sort INT DEFAULT 0,
  criteria JSONB NOT NULL
);
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS emoji TEXT;
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS category TEXT;

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  achievement_code TEXT REFERENCES achievements(code) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, achievement_code)
);

-- Массовые рассылки (раздел «Уведомления»)
CREATE TABLE IF NOT EXISTS broadcasts (
  id SERIAL PRIMARY KEY,
  admin_id INT REFERENCES users(id),
  audience TEXT,                       -- all/subscribed/unsubscribed/new
  kind TEXT,                           -- text/photo/buttons
  text TEXT,
  photo_path TEXT,
  buttons JSONB,
  sent_count INT DEFAULT 0,
  delivered_count INT DEFAULT 0,
  click_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Статус фоновой отправки: pending → sending → done (рассылка идёт в фоне, не в HTTP-запросе).
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'done';

CREATE TABLE IF NOT EXISTS broadcast_clicks (
  id SERIAL PRIMARY KEY,
  broadcast_id INT REFERENCES broadcasts(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  button TEXT,
  clicked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (broadcast_id, user_id, button)
);

-- Безопасность админки: пароль + 2FA
CREATE TABLE IF NOT EXISTS admin_credentials (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT,
  totp_secret TEXT,
  totp_enabled BOOLEAN DEFAULT FALSE,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id SERIAL PRIMARY KEY,
  identifier TEXT,
  ip TEXT,
  success BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_attempts ON admin_login_attempts (identifier, created_at);

-- ============================================================
--  Сиды (идемпотентные)
-- ============================================================

INSERT INTO app_settings (key, value) VALUES
  ('sub_price_basic',     '349'::jsonb),
  ('sub_price_trainer',   '1799'::jsonb),
  ('tariffs',             '[{"id":"basic","title":"PRO","price":349,"period":"мес","duration_days":30,"enabled":true,"features":["Безлимит фото-сканов","AI-добавление текстом","Полная статистика и история","Достижения и серии"]},{"id":"trainer","title":"Тренерская","price":1799,"period":"мес","duration_days":30,"enabled":true,"features":["Всё из PRO","До 20 клиентов","Цели КБЖУ клиентам","Контроль питания и комментарии"]}]'::jsonb),
  ('free_scan_daily_limit', '10'::jsonb),
  ('trial_days',          '3'::jsonb),
  ('trainer_max_clients', '20'::jsonb),
  ('welcome_text',        '"Привет! Я Bytwise — считаю калории и БЖУ по фото и описанию блюда. Сфотографируй еду или просто опиши её текстом."'::jsonb),
  ('paywall_text',        '"Оформите Bytwise PRO: безлимит фото-сканов, AI-добавление текстом и полная статистика."'::jsonb),
  ('support_links',       '{"help":"https://t.me/bytwise_support","privacy":"https://bytwise.app/privacy","terms":"https://bytwise.app/terms"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Обновить цены для уже существующих БД (одноразово к новым значениям прайса)
UPDATE app_settings SET value = '349'::jsonb  WHERE key = 'sub_price_basic'   AND value = '299'::jsonb;
UPDATE app_settings SET value = '1799'::jsonb WHERE key = 'sub_price_trainer' AND value IN ('990'::jsonb,'1490'::jsonb);

-- Дополнить тарифы новыми полями (duration_days, enabled) для уже существующих БД.
-- Идемпотентно: COALESCE сохраняет уже заданные значения. Тренерский тариф без флага — выключаем
-- (сохраняем прежнее поведение «тренер недоступен»).
UPDATE app_settings SET value = (
  SELECT jsonb_agg(
    elem
    || jsonb_build_object('duration_days', COALESCE(elem->'duration_days', '30'::jsonb))
    || jsonb_build_object('enabled', COALESCE(elem->'enabled',
         CASE WHEN elem->>'id' = 'trainer' THEN 'false'::jsonb ELSE 'true'::jsonb END))
  )
  FROM jsonb_array_elements(value) elem
)
WHERE key = 'tariffs' AND jsonb_typeof(value) = 'array' AND jsonb_array_length(value) > 0;

-- Однократно включить тренерский тариф для уже существующих БД (раньше был enabled:false).
-- Маркер не даёт повторно включать его на каждом старте — админ может выключить через админку.
UPDATE app_settings SET value = (
  SELECT jsonb_agg(CASE WHEN elem->>'id' = 'trainer' THEN jsonb_set(elem, '{enabled}', 'true') ELSE elem END)
  FROM jsonb_array_elements(value) elem
)
WHERE key = 'tariffs' AND jsonb_typeof(value) = 'array' AND jsonb_array_length(value) > 0
  AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'trainer_enabled_migrated');
INSERT INTO app_settings (key, value) VALUES ('trainer_enabled_migrated', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;

-- Переименование тренерского тарифа «С тренером» → «Тренерская» для уже существующих БД.
-- Идемпотентно: трогаем только если title всё ещё старый.
UPDATE app_settings SET value = (
  SELECT jsonb_agg(CASE WHEN elem->>'id' = 'trainer'
    THEN jsonb_set(elem, '{title}', '"Тренерская"') ELSE elem END)
  FROM jsonb_array_elements(value) elem
)
WHERE key = 'tariffs' AND jsonb_typeof(value) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(value) e
              WHERE e->>'id' = 'trainer' AND e->>'title' = 'С тренером');

-- «Один клиент — один тренер» на уровне БД (PK (trainer_id, client_id) это не гарантирует).
-- Сначала убираем возможные дубли (оставляя самую раннюю привязку), затем UNIQUE-индекс по client_id.
-- Он же используется для запросов «кто мой тренер» / доступа.
DELETE FROM trainer_clients a USING trainer_clients b
 WHERE a.client_id = b.client_id AND a.ctid > b.ctid;
DROP INDEX IF EXISTS idx_trainer_clients_client;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_trainer_clients_client ON trainer_clients (client_id);

-- Идемпотентность оплаты на уровне БД: один succeeded-платёж на yukassa_id.
-- Защищает от гонки двойного вебхука ЮKassa (повтор уведомления → дубль подписки/реф-бонуса).
-- Сначала убираем уже накопившиеся succeeded-дубли (оставляя самую раннюю строку), затем UNIQUE.
DELETE FROM payments a USING payments b
 WHERE a.status = 'succeeded' AND b.status = 'succeeded'
   AND a.yukassa_id = b.yukassa_id AND a.yukassa_id IS NOT NULL AND a.ctid > b.ctid;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_succeeded_yukassa
  ON payments (yukassa_id) WHERE status = 'succeeded' AND yukassa_id IS NOT NULL;

-- Почасовой перебор пользователей в напоминаниях/рассылках (notifications_enabled AND NOT is_blocked
-- AND NOT tg_unreachable) — частичный индекс, чтобы не сканировать всю таблицу users.
CREATE INDEX IF NOT EXISTS idx_users_notify ON users (id)
  WHERE notifications_enabled = TRUE AND is_blocked = FALSE AND tg_unreachable = FALSE;

-- Полный набор достижений. Удаляем устаревшие коды и апсертим актуальные.
DELETE FROM achievements WHERE code NOT IN (
  'first_scan','manual_entry','profile_set','goal_start',
  'streak_3','streak_7','streak_14','streak_30','streak_60',
  'scans_10','scans_50','scans_100','scans_500',
  'weight_first','weight_down_1','weight_down_5','weight_goal','stability_14',
  'sub_first','sub_pro7','sub_month','sub_influential',
  'clean_day','dessert','macro_balance','control_master',
  'cheat_day','skip_day','back_in_game','count_all'
);

INSERT INTO achievements (code, title, subtitle, description, emoji, icon, color, category, sort, criteria) VALUES
  ('first_scan',    'Первый шаг',            'Сделал первый скан еды',          'Вы сделали первый скан еды. Начало положено!',                 '🍽', 'camera',  '#7C3AED', 'Базовые', 1,  '{"type":"total_scans","value":1}'::jsonb),
  ('manual_entry',  'Записал жизнь',         'Добавил еду вручную',             'Вы добавили блюдо вручную или текстом.',                       '🧾', 'edit',    '#7C3AED', 'Базовые', 2,  '{"type":"manual_scans","value":1}'::jsonb),
  ('profile_set',   'Настроил себя',         'Заполнил профиль',                'Вы заполнили профиль: рост, вес и цель.',                      '⚙️', 'gear',    '#7C3AED', 'Базовые', 3,  '{"type":"profile_filled"}'::jsonb),
  ('goal_start',    'Старт цели',            'Выбрал цель',                     'Вы выбрали цель: похудение, набор или поддержание.',           '🎯', 'target',  '#7C3AED', 'Базовые', 4,  '{"type":"goal_set"}'::jsonb),

  ('streak_3',      '3 дня контроля',        '3 дня подряд лог питания',        'Три дня подряд вы вели дневник питания.',                      '📅', 'flame',   '#22C55E', 'Стрики', 5,  '{"type":"streak","value":3}'::jsonb),
  ('streak_7',      'Неделя дисциплины',     '7 дней подряд',                   'Целую неделю без пропусков. Отличная дисциплина!',             '📅', 'flame',   '#22C55E', 'Стрики', 6,  '{"type":"streak","value":7}'::jsonb),
  ('streak_14',     'Железная воля',         '14 дней подряд',                  'Две недели подряд лог питания.',                               '📅', 'flame',   '#16A34A', 'Стрики', 7,  '{"type":"streak","value":14}'::jsonb),
  ('streak_30',     'Машина режима',         '30 дней подряд',                  'Месяц без пропусков. Вы — машина режима!',                     '📅', 'flame',   '#EA580C', 'Стрики', 8,  '{"type":"streak","value":30}'::jsonb),
  ('streak_60',     'Срыв? не слышал',       '60 дней без пропусков',           '60 дней подряд. Несокрушимая дисциплина.',                     '💀', 'trophy',  '#E0A020', 'Стрики', 9,  '{"type":"streak","value":60}'::jsonb),

  ('scans_10',      'Фуд-детектив',          '10 сканов еды',                   'Вы сделали 10 сканов еды.',                                    '📸', 'camera',  '#3B82F6', 'Сканирование', 10, '{"type":"total_scans","value":10}'::jsonb),
  ('scans_50',      'Повар-исследователь',   '50 сканов',                       'Вы сделали 50 сканов еды.',                                    '🔍', 'camera',  '#3B82F6', 'Сканирование', 11, '{"type":"total_scans","value":50}'::jsonb),
  ('scans_100',     'AI-напарник',           '100 сканов',                      '100 сканов вместе с AI.',                                      '🤖', 'sparkles','#7C3AED', 'Сканирование', 12, '{"type":"total_scans","value":100}'::jsonb),
  ('scans_500',     'Живой холодильник',     '500 сканов',                      '500 сканов еды — впечатляюще!',                                '📦', 'camera',  '#7C3AED', 'Сканирование', 13, '{"type":"total_scans","value":500}'::jsonb),

  ('weight_first',  'Первый контроль',       'Записал вес',                     'Вы записали свой вес впервые.',                                '⚖️', 'weight',  '#22C55E', 'Контроль тела', 14, '{"type":"has_weight"}'::jsonb),
  ('weight_down_1', 'Пошёл вниз',            'Потерял 1 кг',                    'Вы сбросили 1 кг. Дорога начинается с первого шага.',          '📉', 'weight',  '#22C55E', 'Контроль тела', 15, '{"type":"weight_loss_kg","value":1}'::jsonb),
  ('weight_down_5', 'Минус режим',           'Минус 5 кг',                      'Вы сбросили 5 кг. Отличный результат!',                        '📉', 'weight',  '#16A34A', 'Контроль тела', 16, '{"type":"weight_loss_kg","value":5}'::jsonb),
  ('weight_goal',   'Новая версия себя',     'Достиг цели веса',                'Вы достигли целевого веса. Новая версия себя!',                '💪', 'trophy',  '#E0A020', 'Контроль тела', 17, '{"type":"goal_weight_reached"}'::jsonb),
  ('stability_14',  'Стабильность',          '14 дней в норме',                 '14 дней без отклонений от дневной нормы калорий.',             '📊', 'bars',    '#3B82F6', 'Контроль тела', 18, '{"type":"days_in_norm","value":14}'::jsonb),

  ('sub_first',     'Первый апгрейд',        'Купил подписку',                  'Вы оформили первую подписку. Спасибо!',                        '💳', 'crown',   '#7C3AED', 'Подписка', 19, '{"type":"first_payment"}'::jsonb),
  ('sub_pro7',      'Pro режим',             'Активная подписка 7 дней',        'Вы пользуетесь PRO уже неделю.',                               '👑', 'crown',   '#7C3AED', 'Подписка', 20, '{"type":"pro_days","value":7}'::jsonb),
  ('sub_month',     'Поддержал проект',      '1 месяц подписки',                'Вы с PRO целый месяц. Спасибо за поддержку!',                  '💸', 'crown',   '#16A34A', 'Подписка', 21, '{"type":"pro_days","value":30}'::jsonb),
  ('sub_influential','Влиятельный пользователь','3+ месяцев',                   'Вы оформляли подписку 3+ раз. Настоящий фанат Bytwise.',       '🔥', 'trophy',  '#E0A020', 'Подписка', 22, '{"type":"payments_count","value":3}'::jsonb),

  ('clean_day',     'Чистый день',           'День без фастфуда',               'Целый день без фастфуда. Здоровое питание!',                   '🥗', 'apple',   '#22C55E', 'Питание', 23, '{"type":"clean_day"}'::jsonb),
  ('dessert',       'Сладкий грешник',       'Впервые добавил десерт',          'Вы добавили десерт. Иногда можно!',                            '🍫', 'apple',   '#F59E0B', 'Питание', 24, '{"type":"dessert_added"}'::jsonb),
  ('macro_balance', 'Баланс найден',         'Идеальные БЖУ за день',           'Идеальное соотношение БЖУ за день.',                           '⚖️', 'target',  '#3B82F6', 'Питание', 25, '{"type":"ideal_macros_day"}'::jsonb),
  ('control_master','Контроль мастер',       '7 дней в норме по калориям',      '7 дней в пределах нормы калорий.',                             '📊', 'bars',    '#7C3AED', 'Питание', 26, '{"type":"days_in_norm","value":7}'::jsonb),

  ('cheat_day',     'Один чит-день',         'Впервые превысил калории',        'Вы впервые превысили дневную норму калорий. Бывает!',          '🍕', 'flame',   '#EF4444', 'Особые', 27, '{"type":"day_over_norm"}'::jsonb),
  ('skip_day',      'Я вернусь завтра',      'Пропуск 1 дня',                   'Вы пропустили один день. Главное — вернуться!',                '🧃', 'clock',   '#F59E0B', 'Особые', 28, '{"type":"missed_one_day"}'::jsonb),
  ('back_in_game',  'Снова в игре',          'Вернулся после перерыва',         'Вы вернулись после перерыва. Так держать!',                    '🔥', 'flame',   '#22C55E', 'Особые', 29, '{"type":"returned_after_break"}'::jsonb),
  ('count_all',     'Я теперь считаю всё',   '100% дней с логом за неделю',     'Каждый день недели — с логом питания. 100%!',                  '🧠', 'sparkles','#7C3AED', 'Особые', 30, '{"type":"full_week_logged","value":7}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, description=EXCLUDED.description,
  emoji=EXCLUDED.emoji, icon=EXCLUDED.icon, color=EXCLUDED.color, category=EXCLUDED.category,
  sort=EXCLUDED.sort, criteria=EXCLUDED.criteria;

-- ============================================================
--  Техподдержка (отдельный бот support/ + раздел «Поддержка» в админке).
--  ВНИМАНИЕ: копия этого блока — в support/src/schema.sql (бот сам создаёт
--  таблицы на старте, чтобы не зависеть от migrate основного приложения).
--  При изменении править ОБА файла.
-- ============================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,              -- telegram_id пользователя (НЕ users.id)
  username TEXT,                        -- @username на момент обращения
  user_name TEXT,                       -- имя из Telegram на момент обращения
  status TEXT NOT NULL DEFAULT 'open',  -- open | closed
  subject TEXT,                         -- первые ~200 символов первого сообщения
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by BIGINT                      -- telegram_id админа, закрывшего тикет
);
-- Один открытый тикет на пользователя (и защита от гонки при создании).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_support_open_per_user
  ON support_tickets (user_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_support_tickets_status
  ON support_tickets (status, updated_at DESC);
-- Публичный номер обращения — случайный 6-значный (НЕ порядковый id), чтобы не выдавать
-- общее число тикетов. Новые получают случайный номер при создании (support/src/handlers/user.js).
-- Бэкфилл старых: детерминированный разброс id*73 mod 900000 — это биекция по модулю,
-- значит номера уникальны, но «вперемешку» (а не 1,2,3). Делаем ДО уникального индекса.
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS ticket_no INT;
UPDATE support_tickets SET ticket_no = 100000 + ((id * 73) % 900000) WHERE ticket_no IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_support_ticket_no ON support_tickets (ticket_no);

CREATE TABLE IF NOT EXISTS support_messages (
  id SERIAL PRIMARY KEY,
  ticket_id INT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,                 -- 'user' | 'admin'
  admin_id BIGINT,                      -- telegram_id админа (NULL для sender='user')
  via TEXT DEFAULT 'bot',               -- bot | web — откуда отправлен ответ админа
  text TEXT,
  photo_file_id TEXT,                   -- file_id фото в Telegram (бот поддержки)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket
  ON support_messages (ticket_id, created_at);

-- ============================================================
--  Напоминания о подписке/пробном периоде (jobs/subscriptionReminders.js).
--  Одна строка = одна отправленная стадия. UNIQUE-ключ включает anchor_at
--  (expires_at подписки или конец триала): после продления появляется новый
--  anchor — серия начинается заново, старые отметки не мешают.
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_reminders (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,             -- paid_pre | paid_post | trial | trial_post
  stage TEXT NOT NULL,            -- d{N} (до конца) / p{N} (после) / start | end (триал)
  anchor_at TIMESTAMPTZ NOT NULL, -- expires_at подписки или расчётный конец триала
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, kind, stage, anchor_at)
);
CREATE INDEX IF NOT EXISTS idx_sub_reminders_user ON subscription_reminders (user_id, kind);

-- ============================================================
--  Сотрудники-пиарщики (Поправка №43). НЕ путать с legacy referrals выше:
--  та система удалена, эти таблицы — новый учёт наёмных пиарщиков.
--  Ссылка сотрудника: t.me/<бот>?start=emp_<code>. Рефералом становится только
--  НОВЫЙ пользователь; подтверждение через 24 ч (jobs/employeeReferrals.js):
--  открыл приложение + в канале + не заблокировал бота.
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  user_id INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,              -- часть ссылки: emp_<code>
  active BOOLEAN DEFAULT TRUE,            -- FALSE = уволен: ссылка гаснет, /ref и /stat молчат
  added_by INT REFERENCES users(id),      -- админ, выдавший роль
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS employee_payouts (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                     -- referrals (за людей) | subscriptions (за оплаты)
  unit_count INT NOT NULL,
  unit_rate INT NOT NULL,                 -- ₽ за единицу (вводит админ при выплате)
  total INT NOT NULL,                     -- unit_count * unit_rate
  status TEXT NOT NULL DEFAULT 'paid',    -- paid | cancelled
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by INT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_emp_payouts ON employee_payouts (employee_id, created_at DESC);

-- Каждый /start по emp_-ссылке (в т.ч. существующих пользователей — для воронки в /stat).
CREATE TABLE IF NOT EXISTS employee_link_clicks (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  telegram_id BIGINT,
  existing_user BOOLEAN DEFAULT FALSE,    -- TRUE = уже был в базе / сам сотрудник → рефералом не стал
  clicked_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emp_clicks ON employee_link_clicks (employee_id, clicked_at);

CREATE TABLE IF NOT EXISTS employee_referrals (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  user_id INT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- один юзер — один сотрудник
  status TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | rejected
  reject_reason TEXT,                     -- app_not_opened | left_channel | blocked_bot
  payout_id INT REFERENCES employee_payouts(id) ON DELETE SET NULL,   -- NULL = ещё не выплачено
  created_at TIMESTAMPTZ DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_emp_refs ON employee_referrals (employee_id, status, created_at);

-- Оплаты рефералов, засчитанные сотруднику (каждая, включая продления).
-- UNIQUE (payment_id) — идемпотентность атрибуции при повторе вебхука/reconcile.
CREATE TABLE IF NOT EXISTS employee_payments (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  referral_id INT NOT NULL REFERENCES employee_referrals(id) ON DELETE CASCADE,
  payment_id INT UNIQUE NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount INT NOT NULL,
  payout_id INT REFERENCES employee_payouts(id) ON DELETE SET NULL,   -- NULL = ещё не выплачено
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emp_payments ON employee_payments (employee_id, created_at);
