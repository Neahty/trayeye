// Личное сообщение пользователю, отправленное админом прямо из канала логов
// (Поправка №49). Человек видит обычное сообщение от бота — ни имени админа,
// ни пометки «это ответ поддержки» в нём нет: со стороны это выглядит как рассылка.
//
// Черновик сохраняется в БД до подтверждения: в callback_data кнопки помещается
// только 64 байта, поэтому по кнопке едет id строки, а текст берётся отсюда.
const db = require("../db");
const { sendMessage } = require("./telegram");

// Лимит Telegram на длину текстового сообщения.
const MAX_LEN = 4096;

// Получатель со всеми флагами доставки — findById в moderation их не отдаёт.
async function recipient(userId) {
  const { rows } = await db.query(
    `SELECT id, telegram_id, username, name, is_blocked, tg_unreachable, created_at
       FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

// Черновик: создаётся при показе карточки, отправляется только по кнопке.
async function createDraft(userId, text) {
  const { rows } = await db.query(
    "INSERT INTO channel_messages (user_id, text) VALUES ($1, $2) RETURNING *",
    [userId, text]
  );
  return rows[0];
}

async function getDraft(id) {
  const { rows } = await db.query("SELECT * FROM channel_messages WHERE id = $1", [id]);
  return rows[0] || null;
}

// Занять черновик под отправку. Guard по статусу закрывает двойное нажатие кнопки
// двумя админами одновременно: строку заберёт только первый UPDATE.
async function claimDraft(id, byTelegramId) {
  const { rows } = await db.query(
    `UPDATE channel_messages SET status = 'sending', sent_by = $2, decided_at = NOW()
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, byTelegramId ? String(byTelegramId) : null]
  );
  return rows[0] || null;
}

async function finish(id, status, error = null) {
  await db.query(
    "UPDATE channel_messages SET status = $2, error = $3, decided_at = NOW() WHERE id = $1",
    [id, status, error ? String(error).slice(0, 500) : null]
  );
}

async function cancel(id, byTelegramId) {
  const { rows } = await db.query(
    `UPDATE channel_messages SET status = 'canceled', sent_by = $2, decided_at = NOW()
      WHERE id = $1 AND status = 'pending' RETURNING id`,
    [id, byTelegramId ? String(byTelegramId) : null]
  );
  return !!rows[0];
}

// Собственно доставка. parse_mode гасим: админ пишет обычным текстом, а любые
// «<», «&» в нём Telegram с HTML-разметкой отверг бы целиком.
async function deliver(user, text) {
  const res = await sendMessage(user.telegram_id, text, { parse_mode: undefined });
  if (res?.ok === false) {
    // 403 = бот заблокирован пользователем или он не жал Start. Помечаем, чтобы
    // человек не попадал в будущие рассылки (так же поступает broadcast.js).
    if (res.error_code === 403) {
      await db.query("UPDATE users SET tg_unreachable = TRUE WHERE id = $1", [user.id]).catch(() => {});
    }
    return { ok: false, error: res.error || "Telegram не принял сообщение" };
  }
  return { ok: true };
}

// Отправка подтверждённого черновика: занять → доставить → записать итог + аудит.
async function send(id, { byTelegramId, actorUserId = null } = {}) {
  const draft = await claimDraft(id, byTelegramId);
  if (!draft) {
    const existing = await getDraft(id);
    return { ok: false, busy: true, status: existing?.status || "unknown" };
  }

  const user = await recipient(draft.user_id);
  if (!user) {
    await finish(id, "failed", "пользователь удалён из базы");
    return { ok: false, error: "Пользователь удалён из базы." };
  }
  if (user.is_blocked) {
    await finish(id, "failed", "пользователь заблокирован");
    return { ok: false, error: "Пользователь заблокирован — сообщение не отправлено." };
  }

  const res = await deliver(user, draft.text);
  await finish(id, res.ok ? "sent" : "failed", res.error);
  if (res.ok) {
    await db.logAction(actorUserId, "admin_action", {
      action: "channel_dm",
      target: draft.user_id,
      by_telegram_id: byTelegramId ? String(byTelegramId) : null,
      length: draft.text.length
    }).catch(() => {});
  }
  return { ...res, user, draft };
}

module.exports = { MAX_LEN, recipient, createDraft, getDraft, cancel, send };
