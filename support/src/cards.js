// Формирование карточек тикетов и утилиты отправки.

const TG_TEXT_LIMIT = 4096;
const TG_CAPTION_LIMIT = 1024;

// Экранирование для parse_mode: HTML, чтобы спецсимволы в имени не ломали сообщение.
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Время в том же поясе, что и админка основного приложения.
function fmtWhen(when) {
  const d = when ? new Date(when) : new Date();
  try {
    return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Yekaterinburg" });
  } catch { return d.toISOString(); }
}

// Подпись пользователя: кликабельный @username, иначе кликабельное имя по tg-ссылке.
function userLabel(ticket) {
  if (ticket.username) return `@${esc(ticket.username)}`;
  const nm = esc(ticket.user_name || "Пользователь");
  return `<a href="tg://user?id=${ticket.user_id}">${nm}</a>`;
}

// Текст карточки тикета для админа. appUser - строка из общей таблицы users (или null).
function ticketCard(ticket, appUser, lastText) {
  const lines = [];
  lines.push(`🎫 <b>Тикет №${ticket.ticket_no ?? ticket.id}</b> - ${ticket.status === "open" ? "открыт" : "закрыт"}`);
  lines.push(`От: ${esc(ticket.user_name || "Без имени")} (${userLabel(ticket)})`);
  if (appUser) {
    const opened = appUser.app_opened ? "открывал ✅" : "не открывал ❌";
    lines.push(
      `В приложении: ${esc(appUser.name || "без имени")} · ` +
      `зарегистрирован ${fmtWhen(appUser.created_at)} · приложение ${opened}`
    );
  } else {
    lines.push("В приложении: не найден в базе приложения");
  }
  if (ticket.subject) lines.push(`Тема: ${esc(ticket.subject)}`);
  if (lastText) {
    const cut = lastText.length > 700 ? lastText.slice(0, 700) + "…" : lastText;
    lines.push("", `💬 ${esc(cut)}`);
  }
  lines.push("", `Обновлён: ${fmtWhen(ticket.updated_at)}`);
  return lines.join("\n");
}

function ticketKeyboard(ticketId) {
  return {
    inline_keyboard: [[
      { text: "✍️ Ответить", callback_data: `reply:${ticketId}` },
      { text: "✅ Закрыть", callback_data: `close:${ticketId}` }
    ]]
  };
}

// Шлёт длинный текст частями (лимит Telegram - 4096 символов).
async function sendLong(telegram, chatId, text, extra = {}) {
  for (let i = 0; i < text.length; i += TG_TEXT_LIMIT) {
    const chunk = text.slice(i, i + TG_TEXT_LIMIT);
    // Кнопки (если есть) - только на последней части, чтобы не дублировать.
    const isLast = i + TG_TEXT_LIMIT >= text.length;
    await telegram.sendMessage(chatId, chunk, isLast ? extra : { parse_mode: extra.parse_mode });
  }
}

// Карточка админу: с фото - sendPhoto (caption ≤ 1024, остаток отдельно), без - sendMessage.
async function sendCardToAdmin(telegram, adminId, card, photoFileId, ticketId) {
  const extra = { parse_mode: "HTML", reply_markup: ticketKeyboard(ticketId) };
  if (photoFileId) {
    if (card.length <= TG_CAPTION_LIMIT) {
      await telegram.sendPhoto(adminId, photoFileId, { caption: card, ...extra });
    } else {
      await telegram.sendPhoto(adminId, photoFileId, { caption: card.slice(0, TG_CAPTION_LIMIT), parse_mode: "HTML" });
      await sendLong(telegram, adminId, card.slice(TG_CAPTION_LIMIT), extra);
    }
  } else {
    await sendLong(telegram, adminId, card, extra);
  }
}

module.exports = { esc, fmtWhen, userLabel, ticketCard, ticketKeyboard, sendLong, sendCardToAdmin, TG_CAPTION_LIMIT };
