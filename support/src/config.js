// Конфиг бота поддержки. Всё берётся из support/.env.

const SUPPORT_BOT_TOKEN = process.env.SUPPORT_BOT_TOKEN || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

// Telegram ID админов - они получают тикеты и отвечают пользователям.
const ADMIN_IDS = (process.env.SUPPORT_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAdmin(telegramId) {
  return ADMIN_IDS.includes(String(telegramId));
}

// Что видит заблокированный пользователь. Дубль константы из
// server/src/services/moderation.js - процессы разные, общего кода у них нет.
// Меняете здесь - поменяйте и там.
const BLOCKED_TEXT = "🌐 Bytwise не доступен в вашей стране.";

function assertConfig() {
  const missing = [];
  if (!SUPPORT_BOT_TOKEN) missing.push("SUPPORT_BOT_TOKEN");
  if (!DATABASE_URL) missing.push("DATABASE_URL");
  if (!ADMIN_IDS.length) missing.push("SUPPORT_ADMIN_IDS");
  if (missing.length) {
    console.error(`[support] В support/.env не заданы: ${missing.join(", ")}`);
    process.exit(1);
  }
}

module.exports = { SUPPORT_BOT_TOKEN, DATABASE_URL, ADMIN_IDS, isAdmin, assertConfig, BLOCKED_TEXT };
