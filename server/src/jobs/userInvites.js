// Проверка пользовательских приглашений «Пригласи друга» (запускается ежечасно на :25,
// на 5 минут позже сотрудничьей — чтобы два прохода по users не совпадали).
// Приглашения старше 24 часов → confirmed или rejected по правилу
// «открыл приложение + в канале + не заблокировал бота» (состояние на момент проверки).
// Атрибуции оплат здесь нет: денег в этой механике не платят, награда за конкурс — вручную.
const db = require("../db");
const userInvites = require("../services/userInvites");
const channelLog = require("../services/channelLog");
const notify = require("../services/notify");

async function runUserInviteChecks() {
  const { rows: pending } = await db.query(
    `SELECT i.id, i.inviter_id, i.user_id, u.app_opened, u.channel_member, u.tg_unreachable
       FROM user_invites i
       JOIN users u ON u.id = i.user_id
      WHERE i.status = 'pending' AND i.created_at <= NOW() - interval '24 hours'`
  );

  let confirmed = 0;
  let rejected = 0;
  for (const r of pending) {
    let reason = null;
    if (!r.app_opened) reason = "app_not_opened";
    else if (!r.channel_member) reason = "left_channel";
    else if (r.tg_unreachable) reason = "blocked_bot";
    const status = reason ? "rejected" : "confirmed";

    // Guard по status='pending' — защита от гонки с параллельным запуском.
    const upd = await db.query(
      `UPDATE user_invites SET status = $2, reject_reason = $3, decided_at = NOW()
        WHERE id = $1 AND status = 'pending' RETURNING id`,
      [r.id, status, reason]
    );
    if (!upd.rows.length) continue;
    if (reason) rejected++; else confirmed++;

    // Приглашающему — ЛС с итогом (без имени приведённого), в лог-канал — с именами.
    userInvites.notifyDecided(r.inviter_id, status, reason).catch(() => {});
    try {
      const who = await notify.userLabel(r.user_id);
      const inviterWho = await notify.userLabel(r.inviter_id);
      channelLog.post(
        "invites",
        reason
          ? `❌ <b>Приглашение отклонено</b>\n\nДруг ${who}, приглашённый ${inviterWho}, не прошёл проверку 24 ч: ${userInvites.REASONS[reason]}.`
          : `✅ <b>Приглашение засчитано</b>\n\nДруг ${who}, приглашённый ${inviterWho}, прошёл проверку 24 ч.`
      ).catch(() => {});
    } catch (e) {
      console.error("[invites job] log:", e.message);
    }
  }
  if (pending.length) {
    console.log(`[cron] userInvites: confirmed=${confirmed} rejected=${rejected}`);
  }
}

module.exports = { runUserInviteChecks };
