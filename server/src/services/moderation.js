// Блокировка пользователей — единственное место, где меняется users.is_blocked.
// Сюда ходят оба пути бана: кнопка в веб-админке (routes/admin.js) и команды
// «.запретить»/«.разрешить» из канала логов (services/bot.js). За счёт этого защита
// «админа забанить нельзя» и запись аудита живут в одном месте, а не дублируются.
const db = require("../db");

// Что видит заблокированный — везде одинаково: и в мини-аппе, и в боте, и в поддержке.
// Легенда про страну, а не «вы забанены»: так решено продуктово.
const BLOCKED_TEXT = "🌐 Bytwise не доступен в вашей стране.";

// Пользователь по внутреннему id.
async function findById(id) {
  const { rows } = await db.query(
    `SELECT id, telegram_id, username, name, is_admin, is_blocked, blocked_at, blocked_by, created_at
       FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Пользователь по telegram_id (числовой id, который админ пишет руками в команде).
async function findByTelegramId(telegramId) {
  const { rows } = await db.query(
    `SELECT id, telegram_id, username, name, is_admin, is_blocked, blocked_at, blocked_by, created_at
       FROM users WHERE telegram_id = $1`,
    [String(telegramId)]
  );
  return rows[0] || null;
}

// Аккаунт админа банить нельзя — ни из админки, ни из канала.
// Проверяем и флаг в базе, и список из ADMIN_TELEGRAM_IDS: флаг проставляется
// при старте сервера, а список — источник правды, и он мог пополниться.
async function isProtected(userId) {
  const u = await findById(userId);
  if (!u) return false;
  return u.is_admin === true || db.getAdminIds().includes(String(u.telegram_id));
}

// Ставит/снимает бан и пишет аудит. byTelegramId — кто нажал (telegram_id админа).
// Значения считаем в JS, а не через CASE в SQL: так у параметров нет неоднозначных типов.
async function setBlocked(userId, blocked, { byTelegramId = null } = {}) {
  await db.query(
    `UPDATE users SET is_blocked = $2, blocked_at = $3, blocked_by = $4 WHERE id = $1`,
    [
      userId,
      blocked,
      blocked ? new Date() : null,
      blocked && byTelegramId ? String(byTelegramId) : null
    ]
  );
  // Автор действия в system_logs — тот же пользователь, если админ есть в базе;
  // иначе просто NULL, лишь бы сам факт остался в истории.
  const actor = byTelegramId ? await findByTelegramId(byTelegramId) : null;
  await db.logAction(actor?.id || null, "admin_action", {
    action: blocked ? "block" : "unblock",
    target: userId,
    by_telegram_id: byTelegramId ? String(byTelegramId) : null
  });
}

async function blockUser(userId, opts = {}) {
  await setBlocked(userId, true, opts);
}

async function unblockUser(userId, opts = {}) {
  await setBlocked(userId, false, opts);
}

// Забаненный ли (по telegram_id) — для гейтов в боте и в поддержке.
async function isBlockedByTelegramId(telegramId) {
  const { rows } = await db.query(
    "SELECT is_blocked FROM users WHERE telegram_id = $1",
    [String(telegramId)]
  );
  return rows[0]?.is_blocked === true;
}

// Текущие баны — для команды «.баны» в канале.
async function listBlocked(limit = 50) {
  const { rows } = await db.query(
    `SELECT id, telegram_id, username, name, blocked_at
       FROM users
      WHERE is_blocked = TRUE
      ORDER BY blocked_at DESC NULLS LAST, id DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function countBlocked() {
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM users WHERE is_blocked = TRUE");
  return rows[0]?.n || 0;
}

module.exports = {
  BLOCKED_TEXT,
  findById,
  findByTelegramId,
  isProtected,
  blockUser,
  unblockUser,
  isBlockedByTelegramId,
  listBlocked,
  countBlocked
};
