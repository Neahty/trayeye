// Логика админа: всё по кнопкам. Карточки тикетов приходят сами,
// «Ответить» / «Закрыть» — inline-кнопки, меню по /start.

const db = require("../db");
const { ADMIN_IDS } = require("../config");
const { esc, ticketCard, sendCardToAdmin, sendLong, TG_CAPTION_LIMIT } = require("../cards");
const { getAppUser } = require("./user");

// adminTelegramId -> ticketId: кому какой тикет сейчас отвечает админ.
// Теряется при рестарте — не страшно, админ снова нажмёт «Ответить».
const pending = new Map();

const REPLY_PREFIX = "💬 Ответ поддержки Bytwise:\n\n";

function adminName(from) {
  return [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "Админ";
}

// Уведомить остальных админов (кроме исключённого) короткой пометкой.
async function notifyOtherAdmins(telegram, exceptId, text) {
  for (const id of ADMIN_IDS) {
    if (String(id) === String(exceptId)) continue;
    try { await telegram.sendMessage(id, text, { parse_mode: "HTML" }); } catch { /* не падаем */ }
  }
}

async function getTicket(id) {
  const { rows } = await db.query("SELECT * FROM support_tickets WHERE id = $1", [id]);
  return rows[0] || null;
}

async function start(ctx) {
  await ctx.reply("🛠 Панель поддержки Bytwise", {
    reply_markup: { inline_keyboard: [[{ text: "📂 Открытые тикеты", callback_data: "list" }]] }
  });
}

async function cancel(ctx) {
  if (pending.delete(String(ctx.from.id))) {
    await ctx.reply("Отменено. Ответ не отправлен.");
  } else {
    await ctx.reply("Нечего отменять.");
  }
}

// Кнопка «Открытые тикеты»: карточки последних открытых.
async function onList(ctx) {
  await ctx.answerCbQuery();
  const { rows } = await db.query(
    `SELECT t.*,
            (SELECT m.text FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_text,
            (SELECT m.photo_file_id FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_photo
     FROM support_tickets t
     WHERE t.status = 'open'
     ORDER BY t.updated_at DESC
     LIMIT 10`
  );
  if (!rows.length) {
    await ctx.reply("Открытых тикетов нет 🎉");
    return;
  }
  for (const t of rows) {
    const appUser = await getAppUser(t.user_id).catch(() => null);
    const card = ticketCard(t, appUser, t.last_text);
    try {
      await sendCardToAdmin(ctx.telegram, ctx.from.id, card, t.last_photo, t.id);
    } catch (err) {
      console.error("[support] карточка из списка не отправлена:", err.message);
    }
  }
  const { rows: cnt } = await db.query("SELECT COUNT(*)::int AS c FROM support_tickets WHERE status = 'open'");
  if (cnt[0].c > rows.length) {
    await ctx.reply(`…и ещё ${cnt[0].c - rows.length}. Полный список — в веб-админке, раздел «Поддержка».`);
  }
}

// Кнопка «Ответить».
async function onReplyBtn(ctx) {
  const id = Number(ctx.match[1]);
  const ticket = await getTicket(id);
  if (!ticket || ticket.status !== "open") {
    await ctx.answerCbQuery("Тикет уже закрыт", { show_alert: true });
    return;
  }
  pending.set(String(ctx.from.id), id);
  await ctx.answerCbQuery();
  await ctx.reply(`Напишите ответ для тикета №${ticket.ticket_no ?? id} (текст или фото). /cancel — отменить.`);
}

// Кнопка «Закрыть».
async function onCloseBtn(ctx) {
  const id = Number(ctx.match[1]);
  const { rows } = await db.query(
    `UPDATE support_tickets
     SET status = 'closed', closed_at = NOW(), closed_by = $2, updated_at = NOW()
     WHERE id = $1 AND status = 'open' RETURNING *`,
    [id, String(ctx.from.id)]
  );
  const ticket = rows[0];
  if (!ticket) {
    await ctx.answerCbQuery("Уже закрыт", { show_alert: true });
    return;
  }
  await ctx.answerCbQuery("Тикет закрыт ✅");
  // Убираем кнопки у карточки (может не получиться у старых сообщений — не страшно).
  try { await ctx.editMessageReplyMarkup(undefined); } catch { /* ок */ }

  const no = ticket.ticket_no ?? ticket.id;
  try {
    await ctx.telegram.sendMessage(
      ticket.user_id,
      `✅ Обращение №${no} закрыто. Если проблема осталась — просто напишите снова, мы создадим новое.`
    );
  } catch { /* пользователь мог заблокировать бота */ }

  await notifyOtherAdmins(ctx.telegram, ctx.from.id, `✅ Тикет №${no} закрыл ${esc(adminName(ctx.from))}`);
  await ctx.reply(`Тикет №${no} закрыт.`);
}

// Текст/фото от админа: если ждём ответ — отправляем пользователю.
async function onMessage(ctx) {
  const adminId = String(ctx.from.id);
  const ticketId = pending.get(adminId);
  if (!ticketId) {
    await ctx.reply("Используйте кнопки под карточкой тикета (или /start → «Открытые тикеты»).");
    return;
  }

  const ticket = await getTicket(ticketId);
  if (!ticket || ticket.status !== "open") {
    pending.delete(adminId);
    await ctx.reply(`⚠️ Тикет №${ticket?.ticket_no ?? ticketId} уже закрыт, ответ не отправлен.`);
    return;
  }

  const msg = ctx.message;
  const text = msg.text || msg.caption || null;
  const photoFileId = msg.photo?.length ? msg.photo[msg.photo.length - 1].file_id : null;
  if (!text && !photoFileId) {
    await ctx.reply("Поддерживаются текст и фото. Напишите ответ ещё раз или /cancel.");
    return;
  }

  // Отправляем пользователю; 403 = заблокировал бота — фиксируем в истории, но предупреждаем.
  let delivered = true;
  try {
    if (photoFileId) {
      const caption = REPLY_PREFIX + (text || "");
      if (caption.length <= TG_CAPTION_LIMIT) {
        await ctx.telegram.sendPhoto(ticket.user_id, photoFileId, { caption });
      } else {
        await ctx.telegram.sendPhoto(ticket.user_id, photoFileId, { caption: caption.slice(0, TG_CAPTION_LIMIT) });
        await sendLong(ctx.telegram, ticket.user_id, caption.slice(TG_CAPTION_LIMIT), {});
      }
    } else {
      await sendLong(ctx.telegram, ticket.user_id, REPLY_PREFIX + text, {});
    }
  } catch (err) {
    if (err.response?.error_code === 403) {
      delivered = false;
    } else {
      console.error("[support] ответ пользователю не отправлен:", err.message);
      await ctx.reply("❌ Не удалось отправить ответ (ошибка Telegram). Попробуйте ещё раз.");
      return;
    }
  }

  await db.query(
    `INSERT INTO support_messages (ticket_id, sender, admin_id, via, text, photo_file_id)
     VALUES ($1, 'admin', $2, 'bot', $3, $4)`,
    [ticket.id, adminId, text, photoFileId]
  );
  await db.query("UPDATE support_tickets SET updated_at = NOW() WHERE id = $1", [ticket.id]);
  pending.delete(adminId);

  const no = ticket.ticket_no ?? ticket.id;
  if (delivered) {
    await ctx.reply(`✅ Отправлено в тикет №${no}.`);
    await notifyOtherAdmins(ctx.telegram, adminId, `💬 Тикет №${no}: ответил ${esc(adminName(ctx.from))}`);
  } else {
    await ctx.reply(`🚫 Тикет №${no}: пользователь заблокировал бота — ответ сохранён в истории, но не доставлен.`);
  }
}

module.exports = { start, cancel, onList, onReplyBtn, onCloseBtn, onMessage };
