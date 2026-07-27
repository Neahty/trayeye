// Подарки за приглашения: за каждые N засчитанных друзей — M дней PRO
// (настройки invite_reward_per / invite_reward_days). Подарок не начисляется автоматом
// на баланс: он появляется как «ждёт получения», бот пишет в ЛС с кнопкой, и то же самое
// можно забрать на экране приглашений в мини-аппе.
//
// ВАЖНО про продление. Ручная выдача подписки в админке считает срок от NOW() и гасит
// прежнюю активную строку. Для подарка так нельзя: у человека с оплаченным месяцем
// подарок в 5 дней ОБРЕЗАЛ БЫ оплаченный срок. Поэтому здесь отдельная логика —
// если подписка активна, двигаем её expires_at вперёд, и только если активной нет,
// заводим новую строку от NOW().
const db = require("../db");
const settings = require("../utils/settings");
const { sendMessage } = require("./telegram");
const channelLog = require("./channelLog");
const notify = require("./notify");

// Настройки механики. Любое неположительное значение выключает подарки целиком.
async function config() {
  const s = await settings.getMany(["invite_reward_per", "invite_reward_days"]);
  const per = Number(s.invite_reward_per);
  const days = Number(s.invite_reward_days);
  const enabled = Number.isFinite(per) && per > 0 && Number.isFinite(days) && days > 0;
  return { per, days, enabled };
}

// Начисляет недостающие ступени по числу засчитанных друзей. Идемпотентна
// (UNIQUE user_id+tier), поэтому её безопасно звать после каждого подтверждения.
// Возвращает только НОВЫЕ строки — по ним и шлём ЛС.
async function syncForUser(userId) {
  const { per, days, enabled } = await config();
  if (!enabled) return [];

  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS c FROM user_invites WHERE inviter_id = $1 AND status = 'confirmed'",
    [userId]
  );
  const earned = Math.floor(rows[0].c / per);
  if (earned < 1) return [];

  // generate_series + ON CONFLICT: один запрос закрывает и штатный случай (+1 ступень),
  // и догоняющий пересчёт, если что-то потерялось.
  const ins = await db.query(
    `INSERT INTO invite_rewards (user_id, tier, days)
     SELECT $1, t, $3 FROM generate_series(1, $2) AS t
     ON CONFLICT (user_id, tier) DO NOTHING
     RETURNING *`,
    [userId, earned, days]
  );
  return ins.rows;
}

// ЛС «забери подарок» с кнопкой. notified_at — дедуп: повторный прогон крона не спамит.
async function notifyPending(userId, reward, per) {
  const { rows } = await db.query("SELECT telegram_id, name FROM users WHERE id = $1", [userId]);
  const u = rows[0];
  if (!u?.telegram_id) return false;

  const sent = await sendMessage(
    u.telegram_id,
    `🎁 <b>Подарок за приглашения!</b>\n\n` +
    `Ты привёл ${reward.tier * per} ${plural(reward.tier * per, "друга", "друзей", "друзей")} — держи ` +
    `<b>${reward.days} ${plural(reward.days, "день", "дня", "дней")} PRO</b> бесплатно.\n\n` +
    `Нажми кнопку ниже, чтобы забрать 👇`,
    { reply_markup: { inline_keyboard: [[{ text: `🎁 Забрать ${reward.days} дн. PRO`, callback_data: `invref:${reward.id}` }]] } }
  );
  if (!sent || sent.ok === false) return false; // 403 — бот в ЧС; подарок остаётся ждать в приложении

  await db.query("UPDATE invite_rewards SET notified_at = NOW() WHERE id = $1", [reward.id]);
  return true;
}

// Русское склонение для «1 день / 2 дня / 5 дней».
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// Начислить недостающие ступени и разослать ЛС. Шлём не по «свежим» строкам, а по всем
// неотправленным (`notified_at IS NULL`): так подарок дойдёт и в случае, когда прошлый раз
// ЛС не ушло (бот был в ЧС, сеть отвалилась) — на следующем засчитанном друге догоним.
async function syncAndNotify(userId) {
  const { per, enabled } = await config();
  if (!enabled) return 0;

  const fresh = await syncForUser(userId);
  const { rows: unnotified } = await db.query(
    "SELECT * FROM invite_rewards WHERE user_id = $1 AND status = 'pending' AND notified_at IS NULL ORDER BY tier ASC",
    [userId]
  );

  const freshIds = new Set(fresh.map((r) => r.id));
  for (const reward of unnotified) {
    try {
      await notifyPending(userId, reward, per);
      // В лог-канал пишем только про действительно новые ступени, чтобы повторная
      // попытка доставки ЛС не выглядела как ещё одно начисление.
      if (!freshIds.has(reward.id)) continue;
      const who = await notify.userLabel(userId);
      channelLog.post(
        "invites",
        `🎁 <b>Приглашения: подарок начислен</b>\n\n` +
        `${who} привёл ${reward.tier * per} друзей — начислено ${reward.days} дн. PRO (ждёт получения).\n` +
        `Время: ${notify.fmtWhen()}`
      ).catch(() => {});
    } catch (e) {
      console.error("[inviteRewards] notify:", e.message);
    }
  }
  return fresh.length;
}

// Подарки пользователя для экрана приглашений.
async function listForUser(userId) {
  const { rows } = await db.query(
    "SELECT id, tier, days, status, created_at, claimed_at FROM invite_rewards WHERE user_id = $1 ORDER BY tier ASC",
    [userId]
  );
  return rows;
}

// Продлить PRO на days дней внутри транзакции.
// Активная подписка — двигаем её конец вперёд (подарок не должен обрезать оплаченный срок).
// Активной нет — гасим просроченные active-строки и заводим новую от NOW().
async function grantBonusDays(c, userId, days) {
  const { rows } = await c.query(
    `SELECT id, type FROM subscriptions
      WHERE user_id = $1 AND status = 'active' AND expires_at > NOW()
      ORDER BY expires_at DESC LIMIT 1`,
    [userId]
  );
  const active = rows[0];
  if (active) {
    const upd = await c.query(
      "UPDATE subscriptions SET expires_at = expires_at + make_interval(days => $2::int) WHERE id = $1 RETURNING expires_at",
      [active.id, days]
    );
    return { extended: true, type: active.type, expires_at: upd.rows[0].expires_at };
  }
  await c.query(
    "UPDATE subscriptions SET status='cancelled', auto_renew=FALSE WHERE user_id=$1 AND status='active'",
    [userId]
  );
  const ins = await c.query(
    `INSERT INTO subscriptions (user_id, type, status, started_at, expires_at, auto_renew, method)
     VALUES ($1,'basic','active', NOW(), NOW() + make_interval(days => $2::int), FALSE, 'invite_bonus')
     RETURNING expires_at`,
    [userId, days]
  );
  return { extended: false, type: "basic", expires_at: ins.rows[0].expires_at };
}

// Забрать подарок. Гонка «две вкладки / кнопка в боте и в приложении» закрыта guard'ом
// status='pending' в UPDATE: вторая попытка не найдёт строку и вернёт already_claimed.
async function claim(userId, rewardId) {
  const id = Number(rewardId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 400, error: "bad_id" };

  let result;
  try {
    result = await db.withTx(async (c) => {
      const { rows } = await c.query(
        `UPDATE invite_rewards SET status = 'claimed', claimed_at = NOW()
          WHERE id = $1 AND user_id = $2 AND status = 'pending'
          RETURNING *`,
        [id, userId]
      );
      const reward = rows[0];
      if (!reward) return null;
      const sub = await grantBonusDays(c, userId, reward.days);
      return { reward, sub };
    });
  } catch (err) {
    console.error("[inviteRewards] claim:", err.message);
    return { ok: false, status: 500, error: "claim_failed" };
  }

  if (!result) {
    // Либо чужой/несуществующий подарок, либо его уже забрали.
    const { rows } = await db.query("SELECT status FROM invite_rewards WHERE id = $1 AND user_id = $2", [id, userId]);
    if (!rows.length) return { ok: false, status: 404, error: "not_found" };
    return { ok: false, status: 409, error: "already_claimed" };
  }

  const { reward, sub } = result;
  await db.logAction(userId, "invite_reward_claim", { tier: reward.tier, days: reward.days, extended: sub.extended });

  const who = await notify.userLabel(userId);
  channelLog.post(
    "invites",
    `🎁 <b>Приглашения: подарок получен</b>\n\n` +
    `${who} забрал ${reward.days} дн. PRO за приглашения.\n` +
    `Подписка ${sub.extended ? "продлена" : "открыта"} до ${new Date(sub.expires_at).toLocaleDateString("ru-RU")}.\n` +
    `Время: ${notify.fmtWhen()}`
  ).catch(() => {});

  return { ok: true, days: reward.days, expires_at: sub.expires_at, extended: sub.extended };
}

module.exports = {
  config,
  syncForUser,
  syncAndNotify,
  notifyPending,
  listForUser,
  claim,
  plural
};
