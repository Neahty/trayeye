const crypto = require("crypto");
const axios = require("axios");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// Валидация initData от Telegram Mini App (HMAC-SHA256).
// Возвращает распарсенный объект user или null при невалидной подписи.
function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();
  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Постоянное по времени сравнение (защита от timing-атак на подбор hash).
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // Свежесть: отклоняем устаревшую initData, чтобы перехваченную нельзя было переигрывать вечно.
  const maxAge = Number(process.env.INITDATA_MAX_AGE_SEC) || 86400;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAge) return null;

  const userRaw = params.get("user");
  let user = null;
  try {
    user = userRaw ? JSON.parse(userRaw) : null;
  } catch {
    return null;
  }
  return { user, start_param: params.get("start_param") || null };
}

// Низкоуровневая отправка сообщения через Bot API
async function sendMessage(chatId, text, extra = {}) {
  if (!BOT_TOKEN) {
    console.log(`[telegram:mock] -> ${chatId}: ${text}`);
    return { ok: false, mock: true };
  }
  try {
    const { data } = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { chat_id: chatId, text, parse_mode: "HTML", ...extra },
      { timeout: 10000 }
    );
    return data;
  } catch (err) {
    const tg = err.response?.data;
    console.error("[telegram] sendMessage failed:", tg || err.message);
    // error_code 403 = пользователь не нажимал Start или заблокировал бота.
    return { ok: false, error: tg?.description || err.message, error_code: tg?.error_code };
  }
}

// Отправка фото через Bot API. photo - URL или file_id.
async function sendPhoto(chatId, photo, caption = "", extra = {}) {
  if (!BOT_TOKEN) {
    console.log(`[telegram:mock] photo -> ${chatId}: ${caption}`);
    return { ok: false, mock: true };
  }
  try {
    const { data } = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      { chat_id: chatId, photo, caption, parse_mode: "HTML", ...extra },
      { timeout: 15000 }
    );
    return data;
  } catch (err) {
    console.error("[telegram] sendPhoto failed:", err.response?.data || err.message);
    return { ok: false, error: err.message };
  }
}

// Правка текста уже отправленного сообщения (для текстовых сообщений).
async function editMessageText(chatId, messageId, text, extra = {}) {
  if (!BOT_TOKEN) {
    console.log(`[telegram:mock] edit text ${chatId}/${messageId}: ${text}`);
    return { ok: false, mock: true };
  }
  try {
    const { data } = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`,
      { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...extra },
      { timeout: 10000 }
    );
    return data;
  } catch (err) {
    const tg = err.response?.data;
    console.error("[telegram] editMessageText failed:", tg || err.message);
    return { ok: false, error: tg?.description || err.message };
  }
}

// Правка подписи уже отправленного медиа-сообщения (для фото).
// Текстовое сообщение так править НЕЛЬЗЯ - и наоборот: Telegram не разрешает
// превращать текст в медиа (и обратно) правкой, только пересылкой заново.
async function editMessageCaption(chatId, messageId, caption, extra = {}) {
  if (!BOT_TOKEN) {
    console.log(`[telegram:mock] edit caption ${chatId}/${messageId}: ${caption}`);
    return { ok: false, mock: true };
  }
  try {
    const { data } = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/editMessageCaption`,
      { chat_id: chatId, message_id: messageId, caption, parse_mode: "HTML", ...extra },
      { timeout: 10000 }
    );
    return data;
  } catch (err) {
    const tg = err.response?.data;
    console.error("[telegram] editMessageCaption failed:", tg || err.message);
    return { ok: false, error: tg?.description || err.message };
  }
}

// Копия любого сообщения в другой чат - без пометки «переслано» и без привязки
// к типу контента (фото, голосовое, кружок, стикер и т.д. - всё одним методом).
async function copyMessage(chatId, fromChatId, messageId, extra = {}) {
  if (!BOT_TOKEN) {
    console.log(`[telegram:mock] copy ${fromChatId}/${messageId} -> ${chatId}`);
    return { ok: false, mock: true };
  }
  try {
    const { data } = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/copyMessage`,
      { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId, ...extra },
      { timeout: 15000 }
    );
    return data;
  } catch (err) {
    const tg = err.response?.data;
    console.error("[telegram] copyMessage failed:", tg || err.message);
    return { ok: false, error: tg?.description || err.message };
  }
}

// Возвращает file_id самой свежей аватарки пользователя из Telegram (или null).
// Берём последнее по времени фото (index 0) в наибольшем доступном размере.
async function getUserProfilePhotoFileId(userId) {
  if (!BOT_TOKEN || !userId) return null;
  try {
    const { data } = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos`,
      { user_id: userId, limit: 1 },
      { timeout: 10000 }
    );
    const photos = data?.result?.photos;
    if (!Array.isArray(photos) || !photos.length || !photos[0].length) return null;
    // Каждый элемент - массив размеров одного фото; берём самый крупный (последний).
    const sizes = photos[0];
    return sizes[sizes.length - 1].file_id || null;
  } catch (err) {
    console.error("[telegram] getUserProfilePhotos failed:", err.response?.data || err.message);
    return null;
  }
}

// По file_id получает путь к файлу на серверах Telegram (result.file_path).
async function getFilePath(fileId) {
  if (!BOT_TOKEN || !fileId) return null;
  try {
    const { data } = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile`,
      { file_id: fileId },
      { timeout: 10000 }
    );
    return data?.result?.file_path || null;
  } catch (err) {
    console.error("[telegram] getFile failed:", err.response?.data || err.message);
    return null;
  }
}

// Скачивает файл Telegram по file_path, возвращает Buffer (или null).
async function downloadFile(filePath) {
  if (!BOT_TOKEN || !filePath) return null;
  try {
    const { data } = await axios.get(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`,
      { responseType: "arraybuffer", timeout: 15000 }
    );
    return Buffer.from(data);
  } catch (err) {
    console.error("[telegram] downloadFile failed:", err.response?.status || err.message);
    return null;
  }
}

// Проверка статуса участника чата/канала. Возвращает строку status или null при ошибке.
async function getChatMember(chatId, userId) {
  if (!BOT_TOKEN) return null;
  try {
    const { data } = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`,
      { chat_id: chatId, user_id: userId },
      { timeout: 10000 }
    );
    return data?.result?.status || null;
  } catch (err) {
    console.error("[telegram] getChatMember failed:", err.response?.data || err.message);
    return null;
  }
}

// Кэш членства в канале: { userId -> { member, ts } }, TTL 60 c, чтобы не дёргать Bot API
// на каждый запрос профиля.
const memberCache = new Map();
const MEMBER_TTL_MS = 60 * 1000;

// Подписан ли пользователь на обязательный канал.
// Если канал не задан или нет токена - считаем, что подписан (не ломаем локалку/мок).
async function isChannelMember(userId, { force = false } = {}) {
  const channelId = process.env.REQUIRED_CHANNEL_ID;
  if (!channelId || !BOT_TOKEN || !userId) return true;

  const cached = memberCache.get(userId);
  if (!force && cached && Date.now() - cached.ts < MEMBER_TTL_MS) return cached.member;

  const status = await getChatMember(channelId, userId);
  // member/administrator/creator → подписан; left/kicked/restricted/null → нет.
  const member = ["member", "administrator", "creator"].includes(status);
  memberCache.set(userId, { member, ts: Date.now() });
  return member;
}

module.exports = {
  validateInitData, sendMessage, sendPhoto, getChatMember, isChannelMember,
  editMessageText, editMessageCaption, copyMessage,
  getUserProfilePhotoFileId, getFilePath, downloadFile, BOT_TOKEN
};
