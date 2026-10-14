-- TrayEye: схема БД. Идемпотентна: применяется при каждом старте и через `npm run migrate`.
-- Деньги храним в рублях (NUMERIC), даты учебных дней - DATE в поясе APP_TZ.

CREATE TABLE IF NOT EXISTS kombinats (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id           SERIAL PRIMARY KEY,
  kombinat_id  INT NOT NULL REFERENCES kombinats(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  UNIQUE (kombinat_id, name)
);

CREATE TABLE IF NOT EXISTS schools (
  id           SERIAL PRIMARY KEY,
  kombinat_id  INT NOT NULL REFERENCES kombinats(id) ON DELETE CASCADE,
  number       INT NOT NULL CHECK (number > 0),
  name         TEXT NOT NULL,
  UNIQUE (kombinat_id, number)
);

-- Один директор на школу: новая ссылка на ту же школу переписывает ФИО.
CREATE TABLE IF NOT EXISTS directors (
  id          SERIAL PRIMARY KEY,
  school_id   INT NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  avatar_url  TEXT
);

-- Личные ссылки входа. Сам токен не храним, только sha256 от него:
-- утечка базы не даёт войти по чужой ссылке.
CREATE TABLE IF NOT EXISTS access_links (
  id            SERIAL PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN ('director', 'kombinat')),
  kombinat_id   INT NOT NULL REFERENCES kombinats(id) ON DELETE CASCADE,
  director_id   INT REFERENCES directors(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  CHECK ((role = 'director') = (director_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS classes (
  id              SERIAL PRIMARY KEY,
  school_id       INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  students_count  INT NOT NULL CHECK (students_count >= 0),
  UNIQUE (school_id, name)
);

-- Каталог блюд комбината (в боевой версии подгружается из базы производства).
CREATE TABLE IF NOT EXISTS dishes (
  id             SERIAL PRIMARY KEY,
  kombinat_id    INT NOT NULL REFERENCES kombinats(id) ON DELETE CASCADE,
  supplier_id    INT REFERENCES suppliers(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'other',
  image_url      TEXT,
  portion_grams  INT NOT NULL CHECK (portion_grams > 0),
  portion_price  NUMERIC(10, 2) NOT NULL CHECK (portion_price >= 0),
  UNIQUE (kombinat_id, name)
);

-- Меню школы на день: какие блюда и сколько порций заказано.
CREATE TABLE IF NOT EXISTS menu_items (
  id                SERIAL PRIMARY KEY,
  school_id         INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  dish_id           INT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  planned_portions  INT NOT NULL CHECK (planned_portions >= 0),
  UNIQUE (school_id, date, dish_id)
);
CREATE INDEX IF NOT EXISTS menu_items_school_date ON menu_items (school_id, date);

CREATE TABLE IF NOT EXISTS attendance (
  id             SERIAL PRIMARY KEY,
  class_id       INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  present_count  INT NOT NULL CHECK (present_count >= 0),
  UNIQUE (class_id, date)
);

-- Один снимок подноса с камеры (или загруженный вручную в демо).
CREATE TABLE IF NOT EXISTS tray_scans (
  id          BIGSERIAL PRIMARY KEY,
  school_id   INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  scan_date   DATE NOT NULL,
  photo_path  TEXT,
  source      TEXT NOT NULL DEFAULT 'camera' CHECK (source IN ('camera', 'upload', 'seed')),
  ai_model    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tray_scans_school_date ON tray_scans (school_id, scan_date);

-- Что было на подносе и сколько осталось (0 = съедено всё, 100 = не тронуто).
CREATE TABLE IF NOT EXISTS tray_items (
  id            BIGSERIAL PRIMARY KEY,
  scan_id       BIGINT NOT NULL REFERENCES tray_scans(id) ON DELETE CASCADE,
  dish_id       INT NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  leftover_pct  NUMERIC(5, 2) NOT NULL CHECK (leftover_pct BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS tray_items_scan ON tray_items (scan_id);

-- Лента уведомлений: что нового случилось (блюдо в меню, новое блюдо в каталоге, первый вход директора...).
-- audience = кто видит; у директора school_id = NULL значит «всем директорам комбината».
-- link - путь страницы кабинета, куда ведёт клик по уведомлению.
CREATE TABLE IF NOT EXISTS events (
  id           BIGSERIAL PRIMARY KEY,
  kombinat_id  INT NOT NULL REFERENCES kombinats(id) ON DELETE CASCADE,
  school_id    INT REFERENCES schools(id) ON DELETE CASCADE,
  audience     TEXT NOT NULL CHECK (audience IN ('director', 'kombinat')),
  kind         TEXT NOT NULL,
  text         TEXT NOT NULL,
  link         TEXT NOT NULL CHECK (link LIKE '/%'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS events_feed ON events (kombinat_id, audience, created_at DESC);
