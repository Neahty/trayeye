// Дублирование событий поддержки в Telegram-канал. Канал админит ОСНОВНОЙ бот, поэтому
// постим его токеном (TELEGRAM_BOT_TOKEN в support/.env). Канал и тумблеры берём из общей
// базы (app_settings — те же ключи, что в основном сервере), поэтому управление — из админки.
// Всё опционально: нет токена основного бота или дублирование выключено — просто молчим.
const { Telegram } = require("telegraf");
const db = require("./db");

const MAIN_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const mainTg = MAIN_BOT_TOKEN ? new Telegram(MAIN_BOT_TOKEN) : null;
// Запасной канал — если в app_settings ещё нет сохранённых настроек (админ ни разу не сохранял).
const DEFAULT_CHANNEL = "-1004283676399";

async function cfg() {
  let enabled = true;
  let channel = DEFAULT_CHANNEL;
  let events = {};
  try {
    const { rows } = await db.query(
      "SELECT key, value FROM app_settings WHERE key IN ('tg_log_enabled','tg_log_channel_id','tg_log_events')"
    );
    for (const r of rows) {
      if (r.key === "tg_log_enabled") enabled = r.value !== false;
      else if (r.key === "tg_log_channel_id" && r.value) channel = String(r.value).trim();
      else if (r.key === "tg_log_events" && r.value && typeof r.value === "object") events = r.value;
    }
  } catch { /* нет таблицы/настроек — берём дефолты */ }
  return { enabled, channel, events };
}

async function logSupport(text) {
  if (!mainTg) return;
  try {
    const c = await cfg();
    if (!c.enabled || !c.channel) return;
    if (c.events.support === false) return;
    await mainTg.sendMessage(c.channel, text, { parse_mode: "HTML" });
  } catch (err) {
    console.error("[support:channelLog] failed:", err.message);
  }
}

module.exports = { logSupport };
