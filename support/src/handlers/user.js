// Логика обычного пользователя: любое сообщение попадает в его открытый тикет
// (или создаёт новый), карточка уходит всем админам.

const db = require("../db");
const { ADMIN_IDS } = require("../config");
const { ticketCard, sendCardToAdmin, esc } = require("../cards");
const channelLog = require("../channelLog");

async function start(ctx) {
  await ctx.reply(
    "👋 Это поддержка Bytwise.\n\n" +
    "Опишите проблему текстом или пришлите фото (скриншот) — " +
    "мы ответим прямо здесь, в этом чате."
  );
}

// Данные пользователя из общей базы приложения (может не быть — LEFT JOIN-логика).
async function getAppUser(telegramId) {
  const { rows } = await db.query(
    "SELECT name, created_at, app_opened FROM users WHERE telegram_id = $1",
    [String(telegramId)]
  );
  return rows[0] || null;
}

// Находит открытый тикет пользователя или создаёт новый.
// Возвращает { ticket, created }.
async function findOrCreateTicket(from, text) {
  const userId = String(from.id);
  const userName = [from.first_name, from.last_name].filter(Boolean).join(" ") || null;
  const username = from.username || null;

  const open = await db.query(
    "SELECT * FROM support_tickets WHERE user_id = $1 AND status = 'open'",
    [userId]
  );
  if (open.rows[0]) {
    // Освежаем подпись (имя/username могли смениться) и updated_at.
    const upd = await db.query(
      `UPDATE support_tickets SET updated_at = NOW(), username = $2, user_name = $3
       WHERE id = $1 RETURNING *`,
      [open.rows[0].id, username, userName]
    );
    return { ticket: upd.rows[0], created: false };
  }

  const subject = (text || "Фото").slice(0, 200);
  // Несколько попыток: случайный 6-значный номер тикета может изредка совпасть с уже
  // существующим (уникальный индекс uniq_support_ticket_no) — тогда берём новый и пробуем снова.
  for (let attempt = 0; attempt < 8; attempt++) {
    const ticketNo = 100000 + Math.floor(Math.random() * 900000); // 100000–999999
    try {
      const ins = await db.query(
        `INSERT INTO support_tickets (user_id, username, user_name, subject, ticket_no)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [userId, username, userName, subject, ticketNo]
      );
      return { ticket: ins.rows[0], created: true };
    } catch (err) {
      if (err.code === "23505") {
        // Коллизия по номеру тикета — просто пробуем другой номер.
        if (err.constraint === "uniq_support_ticket_no") continue;
        // Иначе это гонка по uniq_support_open_per_user: тикет успел создаться параллельно.
        const retry = await db.query(
          "SELECT * FROM support_tickets WHERE user_id = $1 AND status = 'open'",
          [userId]
        );
        if (retry.rows[0]) return { ticket: retry.rows[0], created: false };
      }
      throw err;
    }
  }
  throw new Error("не удалось сгенерировать уникальный номер тикета");
}

async function onMessage(ctx) {
  const msg = ctx.message;
  const text = msg.text || msg.caption || null;
  const photoFileId = msg.photo?.length ? msg.photo[msg.photo.length - 1].file_id : null;

  if (!text && !photoFileId) {
    await ctx.reply("Поддерживаются текст и фото. Опишите проблему сообщением 🙏");
    return;
  }

  const { ticket, created } = await findOrCreateTicket(ctx.from, text);

  await db.query(
    `INSERT INTO support_messages (ticket_id, sender, text, photo_file_id)
     VALUES ($1, 'user', $2, $3)`,
    [ticket.id, text, photoFileId]
  );

  await ctx.reply(
    created
      ? `✅ Обращение №${ticket.ticket_no} принято. Ответим здесь же — можно дописать детали следующими сообщениями.`
      : `✉️ Добавлено к обращению №${ticket.ticket_no}.`
  );

  // Карточка всем админам; недоставка одному не валит остальных.
  const appUser = await getAppUser(ctx.from.id).catch(() => null);
  const card = ticketCard(ticket, appUser, text);
  for (const adminId of ADMIN_IDS) {
    try {
      await sendCardToAdmin(ctx.telegram, adminId, card, photoFileId, ticket.id);
    } catch (err) {
      console.error(`[support] карточка админу ${adminId} не доставлена:`, err.message);
    }
  }

  // Дублируем обращение в Telegram-канал (основным ботом, если включено в настройках).
  const who = ctx.from.username
    ? `@${esc(ctx.from.username)}`
    : esc([ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || `#${ctx.from.id}`);
  channelLog.logSupport(
    `🎫 <b>Поддержка — ${created ? "новое обращение" : "новое сообщение"}</b>\n\n` +
    `Тикет №${ticket.ticket_no}\n` +
    `От: ${who}\n` +
    (text ? `💬 ${esc(text.slice(0, 500))}` : "📷 Фото")
  ).catch(() => {});
}

module.exports = { start, onMessage, getAppUser };
