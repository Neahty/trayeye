// Учёт членства в обязательном Telegram-канале и связанные логи.
// «Пользователь = подписчик канала»: лог «Новый пользователь» уходит ровно один раз,
// когда channel_joined_at проставляется впервые; «Вышел из канала» - при отписке.
// Все хелперы идемпотентны (защита от повторных событий из разных источников:
// /start, кнопка «Я подписался», chat_member-апдейты, вход в приложение).
const db = require("../db");
const notify = require("./notify");
const channelLog = require("./channelLog");

// Пользователь подписан на канал. Если членство фиксируется ВПЕРВЫЕ
// (channel_joined_at был NULL) - шлём лог «Новый пользователь».
async function markChannelJoined(userId, source = "channel") {
  if (!userId) return false;
  try {
    const { rows } = await db.query(
      `UPDATE users
          SET channel_member = TRUE,
              channel_joined_at = COALESCE(channel_joined_at, NOW())
        WHERE id = $1 AND channel_joined_at IS NULL
        RETURNING id`,
      [userId]
    );
    if (rows.length) {
      // Первое подтверждённое членство - это и есть «новый пользователь».
      notify.notifyNewUser(userId, source).catch((e) =>
        console.error("[channelMembership] notifyNewUser:", e.message)
      );
      return true;
    }
    // Уже были отмечены ранее - на всякий случай вернём флаг membership (вдруг выходили и вернулись).
    await db.query("UPDATE users SET channel_member = TRUE WHERE id = $1 AND channel_member = FALSE", [userId]);
  } catch (e) {
    console.error("[channelMembership] markChannelJoined:", e.message);
  }
  return false;
}

// Пользователь вышел из канала. Логируем один раз на «выход» (пока был channel_member=TRUE).
async function markChannelLeft(userId) {
  if (!userId) return false;
  try {
    const { rows } = await db.query(
      `UPDATE users SET channel_member = FALSE, channel_left_at = NOW()
        WHERE id = $1 AND channel_member = TRUE
        RETURNING id`,
      [userId]
    );
    if (!rows.length) return false;
    const who = await notify.userLabel(userId);
    channelLog.postFor(
      "channel_left",
      userId,
      `🚪 <b>Вышел из канала</b>\n\n` +
      `${who} отписался от обязательного канала.\n` +
      `Время: ${notify.fmtWhen()}`
    ).catch(() => {});
    return true;
  } catch (e) {
    console.error("[channelMembership] markChannelLeft:", e.message);
  }
  return false;
}

// Бот недоступен пользователю (получили 403 при отправке). Помечаем tg_unreachable
// и логируем один раз - пока флаг был FALSE.
async function markUnreachable(userId) {
  if (!userId) return false;
  try {
    const { rows } = await db.query(
      `UPDATE users SET tg_unreachable = TRUE
        WHERE id = $1 AND tg_unreachable = FALSE
        RETURNING id`,
      [userId]
    );
    if (!rows.length) return false;
    const who = await notify.userLabel(userId);
    channelLog.postFor(
      "blocked_bot",
      userId,
      `🚫 <b>Заблокировал бота</b>\n\n` +
      `${who} заблокировал бота или не начинал диалог - сообщения ему больше не доходят.\n` +
      `Время: ${notify.fmtWhen()}`
    ).catch(() => {});
    return true;
  } catch (e) {
    console.error("[channelMembership] markUnreachable:", e.message);
  }
  return false;
}

module.exports = { markChannelJoined, markChannelLeft, markUnreachable };
