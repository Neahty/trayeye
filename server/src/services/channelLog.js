// Дублирование событий в Telegram-канал (постит ОСНОВНОЙ бот — он должен быть админом канала).
// Канал, мастер-выключатель и тумблеры по типам событий берутся из app_settings («Настройки →
// Логи в Telegram»), поэтому всё динамично, без хардкода. Любая ошибка отправки гасится —
// канал не должен ронять основной поток приложения.
const { sendMessage, sendPhoto } = require("./telegram");
const settings = require("../utils/settings");

const TG_CAPTION_LIMIT = 1024;

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

// Текстовое событие в канал.
async function post(eventKey, text, extra = {}) {
  try {
    const channel = await allowed(eventKey);
    if (!channel) return;
    await sendMessage(channel, text, extra);
  } catch (err) {
    console.error("[channelLog] post failed:", err.message);
  }
}

// Фото-событие в канал (photo — URL или file_id).
async function postPhoto(eventKey, photo, caption = "", extra = {}) {
  try {
    const channel = await allowed(eventKey);
    if (!channel) return;
    const cap = caption.length > TG_CAPTION_LIMIT ? caption.slice(0, TG_CAPTION_LIMIT - 1) + "…" : caption;
    await sendPhoto(channel, photo, cap, extra);
  } catch (err) {
    console.error("[channelLog] postPhoto failed:", err.message);
  }
}

// Ошибка системы — понятным языком.
async function logError(where, message) {
  await post(
    "errors",
    `⚠️ <b>Ошибка в системе</b>\n\n` +
    `Где: <code>${esc(where || "?")}</code>\n` +
    `Что: ${esc(String(message || "").slice(0, 600))}`
  );
}

module.exports = { post, postPhoto, logError, esc };
