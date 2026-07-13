-- ============================================================
--  Таблицы техподдержки. КОПИЯ блока из server/src/db/schema.sql —
--  при изменении править ОБА файла. Всё идемпотентно (IF NOT EXISTS),
--  бот выполняет этот файл на каждом старте.
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
