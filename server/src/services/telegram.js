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

// Отправка фото через Bot API. photo — URL или file_id.
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
// Если канал не задан или нет токена — считаем, что подписан (не ломаем локалку/мок).
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

module.exports = { validateInitData, sendMessage, sendPhoto, getChatMember, isChannelMember, BOT_TOKEN };
