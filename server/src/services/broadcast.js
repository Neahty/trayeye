// Массовые рассылки через Telegram-бот с трекингом доставки/кликов.
const db = require("../db");
const { sendMessage, sendPhoto } = require("./telegram");
const notifyLog = require("./notifyLog");

const SERVER_URL = process.env.SERVER_URL || "";

// Активная подписка - единый признак «подписчика» во всём проекте.
const ACTIVE_SUB = `SELECT user_id FROM subscriptions WHERE status='active' AND expires_at > NOW()`;

function audienceSql(audience) {
  switch (audience) {
    case "subscribed":
      return `u.id IN (${ACTIVE_SUB})`;
    case "unsubscribed":
      return `u.id NOT IN (${ACTIVE_SUB})`;
    case "new":
      return `u.created_at >= NOW() - interval '7 days'`;
    // Подписка ещё активна, но истекает в ближайшие 3 дня - напомнить продлить.
    case "expiring":
      return `u.id IN (SELECT user_id FROM subscriptions WHERE status='active' AND expires_at > NOW() AND expires_at <= NOW() + interval '3 days')`;
    // Была подписка, сейчас активной нет (истекла/отменена) - win-back.
    case "churned":
      return `u.id IN (SELECT user_id FROM subscriptions) AND u.id NOT IN (${ACTIVE_SUB})`;
    case "sub_basic":
      return `u.id IN (SELECT user_id FROM subscriptions WHERE status='active' AND expires_at > NOW() AND type='basic')`;
    case "sub_trainer":
      return `u.id IN (SELECT user_id FROM subscriptions WHERE status='active' AND expires_at > NOW() AND type='trainer')`;
    // Не активированные: не открыли приложение или не вступили в обязательный канал.
    case "inactive":
      return `(u.app_opened = FALSE OR u.channel_member = FALSE)`;
    case "all":
    default:
      return `TRUE`;
  }
}

async function recipients(audience, targetUserIds) {
  // Точечная рассылка конкретным людям: админ выбрал их осознанно, поэтому
  // notifications_enabled не учитываем; исключаем только заблокированных/недоступных.
  if (audience === "user") {
    const ids = Array.isArray(targetUserIds) ? targetUserIds : [];
    if (!ids.length) return [];
    const { rows } = await db.query(
      `SELECT u.id, u.telegram_id FROM users u
       WHERE u.is_blocked = FALSE AND u.tg_unreachable = FALSE AND u.id = ANY($1::int[])`,
      [ids]
    );
    return rows;
  }
  const { rows } = await db.query(
    `SELECT u.id, u.telegram_id FROM users u
     WHERE u.is_blocked = FALSE AND u.tg_unreachable = FALSE AND u.notifications_enabled = TRUE AND ${audienceSql(audience)}`
  );
  return rows;
}

// Кнопки с трекингом клика: url ведёт на /api/track/broadcast/:id (редирект на целевой url)
function buildKeyboard(buttons, broadcastId, userId) {
  if (!Array.isArray(buttons) || !buttons.length) return undefined;
  const inline_keyboard = buttons.map((b, i) => {
    const label = b.text || `Кнопка ${i + 1}`;
    const target = b.url || "";
    let url = target || "https://t.me";
    if (SERVER_URL && target) {
      const params = new URLSearchParams({ u: String(userId), to: target, b: String(i) });
      url = `${SERVER_URL}/api/track/broadcast/${broadcastId}?${params.toString()}`;
    }
    return [{ text: label, url }];
  });
  return { inline_keyboard };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Пауза между отправками: ~25 сообщений/сек, чтобы не упереться в лимит Telegram (~30/сек → 429).
const SEND_GAP_MS = 40;

// Создаёт запись рассылки (status='pending') и СРАЗУ её возвращает - без отправки.
// Реальная отправка выполняется отдельно в runBroadcast(), чтобы HTTP-запрос админа
// не висел минуты на большой аудитории (раньше из-за этого был таймаут и дубли при повторе).
async function createBroadcast({ adminId, audience, kind, text, photoPath, buttons, targetUserIds }) {
  const ins = await db.query(
    `INSERT INTO broadcasts (admin_id, audience, kind, text, photo_path, buttons, status, target_user_ids)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING *`,
    [adminId, audience, kind, text || null, photoPath || null, buttons ? JSON.stringify(buttons) : null,
     Array.isArray(targetUserIds) && targetUserIds.length ? targetUserIds : null]
  );
  return ins.rows[0];
}

// Фоновая отправка ранее созданной рассылки: шлёт всем получателям с троттлингом,
// обновляет sent_count/delivered_count и status. Ошибку одного юзера изолируем (sendMessage
// сам ловит сбой и возвращает объект, не бросая). Вызывать без await.
async function runBroadcast(broadcastId) {
  const { rows } = await db.query("SELECT * FROM broadcasts WHERE id = $1", [broadcastId]);
  const broadcast = rows[0];
  if (!broadcast) return;

  const { kind, text, photo_path: photoPath } = broadcast;
  let buttons = broadcast.buttons;
  if (typeof buttons === "string") { try { buttons = JSON.parse(buttons); } catch { buttons = null; } }

  await db.query("UPDATE broadcasts SET status='sending' WHERE id=$1", [broadcastId]);

  const users = await recipients(broadcast.audience, broadcast.target_user_ids);
  let delivered = 0;

  for (const u of users) {
    const keyboard = kind === "buttons" ? buildKeyboard(buttons, broadcast.id, u.id) : undefined;
    const extra = keyboard ? { reply_markup: keyboard } : {};
    let res;
    if (kind === "photo" && photoPath) {
      const photoUrl = SERVER_URL ? `${SERVER_URL}/${photoPath}` : photoPath;
      res = await sendPhoto(u.telegram_id, photoUrl, text || "", extra);
    } else {
      res = await sendMessage(u.telegram_id, text || "", extra);
    }
    if (res && res.ok !== false) {
      delivered++;
    } else if (res && res.error_code === 403) {
      // Юзер не нажимал Start / заблокировал бота - помечаем, чтобы не слать впустую
      // (как в mealReminders). Сбрасывается при следующем успешном входе.
      await db.query("UPDATE users SET tg_unreachable = TRUE WHERE id = $1", [u.id]);
    }
    // 429 и прочие сбои доставкой не считаем - просто идём дальше.
    await sleep(SEND_GAP_MS);
  }

  await db.query(
    `UPDATE broadcasts SET sent_count=$2, delivered_count=$3, status='done' WHERE id=$1`,
    [broadcast.id, users.length, delivered]
  );
  await db.logAction(broadcast.admin_id, "admin_action", {
    action: "broadcast", broadcast_id: broadcast.id, audience: broadcast.audience,
    sent: users.length, delivered
  });
  // Итог в канал логов - общими цифрами, без перечисления получателей.
  await notifyLog.broadcastRun(broadcast, { sent: users.length, delivered })
    .catch((e) => console.error("[broadcast] log:", e.message));
}

module.exports = { createBroadcast, runBroadcast, recipients, audienceSql };
