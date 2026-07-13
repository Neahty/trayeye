// Отправка сообщений от имени БОТА ПОДДЕРЖКИ (отдельный токен SUPPORT_BOT_TOKEN).
// Используется веб-админкой: ответы в тикеты и проксирование фото из Telegram.
// Сам бот поддержки — отдельное приложение в папке support/, тут только HTTP-вызовы Bot API.
const axios = require("axios");

const TOKEN = process.env.SUPPORT_BOT_TOKEN || "";

async function sendMessage(chatId, text, extra = {}) {
  if (!TOKEN) {
    console.log(`[supportBot:mock] -> ${chatId}: ${text}`);
    return { ok: false, mock: true };
  }
  try {
    const { data } = await axios.post(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      { chat_id: chatId, text, ...extra },
      { timeout: 10000 }
    );
    return data;
  } catch (err) {
    const tg = err.response?.data;
    console.error("[supportBot] sendMessage failed:", tg || err.message);
    // error_code 403 = пользователь не нажимал Start или заблокировал бота.
    return { ok: false, error: tg?.description || err.message, error_code: tg?.error_code };
  }
}

// Кэш ссылок getFile: ссылки живут ≥1 час, держим 30 минут, чтобы не дёргать API на каждый просмотр.
const fileUrlCache = new Map(); // fileId -> { url, ts }
const FILE_URL_TTL_MS = 30 * 60 * 1000;

// Прямая ссылка на файл Telegram по file_id (для проксирования фото в админку).
async function getFileUrl(fileId) {
  if (!TOKEN) return null;
  const cached = fileUrlCache.get(fileId);
  if (cached && Date.now() - cached.ts < FILE_URL_TTL_MS) return cached.url;
  try {
    const { data } = await axios.post(
      `https://api.telegram.org/bot${TOKEN}/getFile`,
      { file_id: fileId },
      { timeout: 10000 }
    );
    const filePath = data?.result?.file_path;
    if (!filePath) return null;
    const url = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
    fileUrlCache.set(fileId, { url, ts: Date.now() });
    return url;
  } catch (err) {
    console.error("[supportBot] getFile failed:", err.response?.data || err.message);
    return null;
  }
}

// Короткая пометка остальным админам в боте поддержки (кроме отвечавшего).
async function notifyOtherAdmins(exceptTelegramId, text) {
  const ids = (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of ids) {
    if (String(id) === String(exceptTelegramId)) continue;
    try { await sendMessage(id, text); } catch { /* одного не достучались — не падаем */ }
  }
}

module.exports = { sendMessage, getFileUrl, notifyOtherAdmins, SUPPORT_BOT_TOKEN: TOKEN };
