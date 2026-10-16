// Привязка Telegram-бота к кабинету. На сайте: «Привязать Telegram» -> QR (ссылка
// t.me/<бот>?start=<код>) или тот же код из 6 символов, который вводят в боте руками.
// Код одноразовый, живёт 15 минут, в базе только sha256 - как у ссылок входа.

const crypto = require("crypto");
const db = require("../db");
const { hashToken } = require("./links");

// Без 0/O и 1/I: код набирают с экрана. 32 символа - байт делится без перекоса.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 15;
const ROLES = ["director", "kombinat", "cook"];

function botUsername() {
  return (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
}

function isConfigured() {
  return Boolean(botUsername());
}

function generateCode() {
  return Array.from(crypto.randomBytes(CODE_LENGTH), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

// «abc-def», «ABC DEF» -> «ABCDEF»; null, если текст на код не похож.
function normalizeCode(text) {
  const code = String(text ?? "").toUpperCase().replace(/[\s-]/g, "");
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

function botLink(code) {
  return `https://t.me/${botUsername()}?start=${code}`;
}

// Новый код для кабинета. q - db или клиент транзакции.
async function createCode(q, { role, kombinatId, schoolId = null, directorId = null }) {
  if (!ROLES.includes(role)) throw new Error(`unknown role ${role}`);
  await q.query("DELETE FROM tg_codes WHERE expires_at < NOW() - INTERVAL '1 day'");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    try {
      const { rows } = await q.query(
        `INSERT INTO tg_codes (code_hash, role, kombinat_id, school_id, director_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(mins => $6)) RETURNING expires_at`,
        [hashToken(code), role, kombinatId, schoolId, directorId, CODE_TTL_MINUTES]
      );
      return { role, code, url: botLink(code), expires_at: rows[0].expires_at };
    } catch (err) {
      if (err.code !== "23505") throw err; // совпал с другим кодом - берём новый
    }
  }
  throw new Error("code_generation_failed");
}

const CHAT_INFO = `
  SELECT c.chat_id, c.role, c.kombinat_id, c.school_id, c.director_id, c.tg_name, c.last_event_id, c.linked_at,
         k.name AS kombinat_name, s.name AS school_name, s.number AS school_number
    FROM tg_chats c
    JOIN kombinats k ON k.id = c.kombinat_id
    LEFT JOIN schools s ON s.id = c.school_id`;

async function chatInfo(q, chatId) {
  const { rows } = await q.query(`${CHAT_INFO} WHERE c.chat_id = $1`, [String(chatId)]);
  return rows[0] || null;
}

// Код из бота -> привязанный чат или null (кода нет, истёк или уже использован).
async function redeemCode(code, { chatId, name }) {
  return db.withTx(async (client) => {
    const { rows } = await client.query(
      `UPDATE tg_codes SET used_at = NOW()
        WHERE code_hash = $1 AND used_at IS NULL AND expires_at > NOW()
        RETURNING role, kombinat_id, school_id, director_id`,
      [hashToken(code)]
    );
    const c = rows[0];
    if (!c) return null;
    // Старые уведомления не шлём: начинаем с последнего события на момент привязки.
    const { rows: last } = await client.query(
      "SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE kombinat_id = $1", [c.kombinat_id]
    );
    await client.query(
      `INSERT INTO tg_chats (chat_id, role, kombinat_id, school_id, director_id, tg_name, last_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (chat_id) DO UPDATE SET role = EXCLUDED.role, kombinat_id = EXCLUDED.kombinat_id,
         school_id = EXCLUDED.school_id, director_id = EXCLUDED.director_id, tg_name = EXCLUDED.tg_name,
         last_event_id = EXCLUDED.last_event_id, linked_at = NOW()`,
      [String(chatId), c.role, c.kombinat_id, c.school_id, c.director_id, name || null, last[0].id]
    );
    return chatInfo(client, chatId);
  });
}

// Чаты кабинета: директор видит свою школу (себя и поваров), комбинат - свои чаты.
async function listChats(cabinet) {
  const { rows } = cabinet.role === "director"
    ? await db.query(`${CHAT_INFO} WHERE c.school_id = $1 ORDER BY c.linked_at`, [cabinet.schoolId])
    : await db.query(`${CHAT_INFO} WHERE c.kombinat_id = $1 AND c.role = 'kombinat' ORDER BY c.linked_at`, [cabinet.kombinatId]);
  return rows.map((r) => ({ chat_id: r.chat_id, role: r.role, tg_name: r.tg_name, linked_at: r.linked_at }));
}

// Отвязать чат из кабинета. true - отвязан, false - такого чата у кабинета нет.
async function unlinkChat(cabinet, chatId) {
  const { rowCount } = cabinet.role === "director"
    ? await db.query("DELETE FROM tg_chats WHERE chat_id = $1 AND school_id = $2", [String(chatId), cabinet.schoolId])
    : await db.query("DELETE FROM tg_chats WHERE chat_id = $1 AND kombinat_id = $2 AND role = 'kombinat'", [String(chatId), cabinet.kombinatId]);
  return rowCount > 0;
}

async function unlinkSelf(chatId) {
  await db.query("DELETE FROM tg_chats WHERE chat_id = $1", [String(chatId)]);
}

// Новые уведомления для чата (как колокольчик в кабинете) и сдвиг отметки «прислано».
// Повару уведомления не нужны: он только присылает фото.
async function takeNewEvents(chat, limit = 10) {
  if (chat.role === "cook") return [];
  const { rows } = chat.role === "director"
    ? await db.query(
      `SELECT id, text, link FROM events
        WHERE kombinat_id = $1 AND audience = 'director' AND (school_id IS NULL OR school_id = $2) AND id > $3
        ORDER BY id LIMIT $4`,
      [chat.kombinat_id, chat.school_id, chat.last_event_id, limit])
    : await db.query(
      `SELECT id, text, link FROM events
        WHERE kombinat_id = $1 AND audience = 'kombinat' AND id > $2
        ORDER BY id LIMIT $3`,
      [chat.kombinat_id, chat.last_event_id, limit]);
  if (rows.length) {
    await db.query("UPDATE tg_chats SET last_event_id = $2 WHERE chat_id = $1", [String(chat.chat_id), rows[rows.length - 1].id]);
  }
  return rows;
}

async function notifiableChats() {
  const { rows } = await db.query(`${CHAT_INFO} WHERE c.role IN ('director', 'kombinat')`);
  return rows;
}

module.exports = {
  ALPHABET, CODE_LENGTH, CODE_TTL_MINUTES,
  isConfigured, botUsername, normalizeCode, createCode, redeemCode, chatInfo,
  listChats, unlinkChat, unlinkSelf, takeNewEvents, notifiableChats
};
