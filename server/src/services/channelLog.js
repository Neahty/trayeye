// Дублирование событий в Telegram-канал (постит ОСНОВНОЙ бот - он должен быть админом канала).
// Канал, мастер-выключатель и тумблеры по типам событий берутся из app_settings («Настройки →
// Логи в Telegram»), поэтому всё динамично, без хардкода. Любая ошибка отправки гасится -
// канал не должен ронять основной поток приложения.
const { sendMessage, sendPhoto, editMessageText, editMessageCaption, copyMessage } = require("./telegram");
const settings = require("../utils/settings");
const db = require("../db");

const TG_CAPTION_LIMIT = 1024;

// Обрезка подписи под лимит Telegram.
function cut(caption) {
  return caption.length > TG_CAPTION_LIMIT ? caption.slice(0, TG_CAPTION_LIMIT - 1) + "…" : caption;
}

// Экранирование для parse_mode: HTML.
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Конфиг канала: включено ли вообще, id канала и карта тумблеров по событиям.
async function cfg() {
  const s = await settings.getMany(["tg_log_enabled", "tg_log_channel_id", "tg_log_events"]);
  return {
    enabled: s.tg_log_enabled !== false,
    channel: s.tg_log_channel_id ? String(s.tg_log_channel_id).trim() : "",
    events: (s.tg_log_events && typeof s.tg_log_events === "object") ? s.tg_log_events : {}
  };
}

// Можно ли постить событие данного типа.
async function allowed(eventKey) {
  const c = await cfg();
  if (!c.enabled || !c.channel) return null;
  if (c.events[eventKey] === false) return null;
  return c.channel;
}

// Текстовое событие в канал. Возвращает ответ Bot API (нужен message_id тем,
// кто потом правит сообщение) или null, если событие не отправлялось.
async function post(eventKey, text, extra = {}) {
  try {
    const channel = await allowed(eventKey);
    if (!channel) return null;
    return await sendMessage(channel, text, extra);
  } catch (err) {
    console.error("[channelLog] post failed:", err.message);
    return null;
  }
}

// Фото-событие в канал (photo - URL или file_id). Возвращает ответ Bot API или null.
async function postPhoto(eventKey, photo, caption = "", extra = {}) {
  try {
    const channel = await allowed(eventKey);
    if (!channel) return null;
    return await sendPhoto(channel, photo, cut(caption), extra);
  } catch (err) {
    console.error("[channelLog] postPhoto failed:", err.message);
    return null;
  }
}

// Правка ранее отправленного текстового события. chatId берём из сохранённой ссылки
// на сообщение, а не из настроек: канал могли сменить в админке уже после отправки.
async function editText(eventKey, chatId, messageId, text, extra = {}) {
  try {
    if (!(await allowed(eventKey)) || !chatId || !messageId) return null;
    return await editMessageText(chatId, messageId, text, extra);
  } catch (err) {
    console.error("[channelLog] editText failed:", err.message);
    return null;
  }
}

// Правка подписи ранее отправленного фото-события.
async function editCaption(eventKey, chatId, messageId, caption, extra = {}) {
  try {
    if (!(await allowed(eventKey)) || !chatId || !messageId) return null;
    return await editMessageCaption(chatId, messageId, cut(caption), extra);
  } catch (err) {
    console.error("[channelLog] editCaption failed:", err.message);
    return null;
  }
}

// Копия сообщения из чата с ботом в канал - любой тип контента как есть.
async function copyTo(eventKey, fromChatId, messageId, extra = {}) {
  try {
    const channel = await allowed(eventKey);
    if (!channel || !fromChatId || !messageId) return null;
    return await copyMessage(channel, fromChatId, messageId, extra);
  } catch (err) {
    console.error("[channelLog] copyTo failed:", err.message);
    return null;
  }
}

// Запоминает, о ком было отправленное в канал сообщение, - чтобы админ мог ответить
// на него «.запретить» и бот понял, про кого речь (см. services/bot.js).
// chatId передаём отдельно: copyMessage возвращает голый message_id, без chat.
async function remember(chatId, apiResult, userId) {
  try {
    const messageId = apiResult?.result?.message_id;
    if (!messageId || !userId || !chatId) return;
    await db.query(
      `INSERT INTO tg_log_refs (chat_id, message_id, user_id) VALUES ($1,$2,$3)
       ON CONFLICT (chat_id, message_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [String(chatId), String(messageId), userId]
    );
  } catch (err) {
    // Ссылка - удобство модерации, а не часть логирования: падать из-за неё нельзя.
    console.error("[channelLog] remember failed:", err.message);
  }
}

// Те же post/postPhoto/copyTo, но с привязкой сообщения к пользователю.
// Используются везде, где лог относится к конкретному человеку.
async function postFor(eventKey, userId, text, extra = {}) {
  const channel = await allowed(eventKey).catch(() => null);
  if (!channel) return null;
  const res = await post(eventKey, text, extra);
  await remember(channel, res, userId);
  return res;
}

async function postPhotoFor(eventKey, userId, photo, caption = "", extra = {}) {
  const channel = await allowed(eventKey).catch(() => null);
  if (!channel) return null;
  const res = await postPhoto(eventKey, photo, caption, extra);
  await remember(channel, res, userId);
  return res;
}

async function copyToFor(eventKey, userId, fromChatId, messageId, extra = {}) {
  const channel = await allowed(eventKey).catch(() => null);
  if (!channel) return null;
  const res = await copyTo(eventKey, fromChatId, messageId, extra);
  await remember(channel, res, userId);
  return res;
}

// Пользователь, о котором сообщение в канале логов (или null, если связи нет -
// например, сообщение отправлено до появления этой функции).
async function userIdByLogMessage(chatId, messageId) {
  try {
    const { rows } = await db.query(
      "SELECT user_id FROM tg_log_refs WHERE chat_id = $1 AND message_id = $2",
      [String(chatId), String(messageId)]
    );
    return rows[0]?.user_id || null;
  } catch (err) {
    console.error("[channelLog] userIdByLogMessage failed:", err.message);
    return null;
  }
}

// Кто напоролся на ошибку - кликабельная подпись для канала: @username, иначе имя.
// Без неё алерт не отличить от фонового шума: непонятно, пострадал ли живой человек.
function whoLabel(u) {
  if (!u) return null;
  if (u.username) return `@${esc(u.username)}`;
  return `<a href="tg://user?id=${u.telegram_id}">${esc(u.name || "Пользователь")}</a>`;
}

// Человеческие названия мест, где может рвануть. Коды вроде "scan_text" в канале
// читать некому: там смотрят, ЧТО сломалось у людей, а не где это лежит в коде.
const WHERE_LABELS = {
  scan: "Скан еды по фото",
  scan_text: "Скан еды по описанию",
  scan_photo_save: "Сохранение фото скана",
  startup: "Запуск сервера"
};

// Ошибка системы - четырьмя строками: кто напоролся, где, что случилось и почему.
// Без «кто» и «почему» алерт бесполезен: видно, что где-то упало, но непонятно,
// задело ли это живого человека и надо ли бежать чинить прямо сейчас.
// who приходит УЖЕ готовым HTML (ссылка на пользователя) - его не экранируем.
async function logError(where, what, extra = {}) {
  const { who = null, why = null } = extra;
  const lines = [];
  if (who) lines.push(`Кто: ${who}`);
  lines.push(`Где: ${esc(WHERE_LABELS[where] || where || "?")}`);
  lines.push(`Что: ${esc(String(what || "сбой").slice(0, 300))}`);
  if (why) lines.push(`Почему: ${esc(String(why).slice(0, 600))}`);
  await post("errors", `⚠️ <b>Ошибка в системе</b>\n\n${lines.join("\n")}`);
}

module.exports = {
  post, postPhoto, editText, editCaption, copyTo, logError, esc, whoLabel,
  postFor, postPhotoFor, copyToFor, userIdByLogMessage
};
