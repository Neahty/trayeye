// Фоновые проверки по сотрудникам-пиарщикам (запускается ежечасно на :20).
// Фаза A: pending-рефералы старше 24 часов → confirmed или rejected по правилу
// «открыл приложение + в канале + не заблокировал бота» (состояние на момент проверки).
// Фаза B: страховочная атрибуция оплат за последние 2 дня - доловит платежи,
// потерянные при падении процесса между COMMIT и хуком, и ручные начисления админом.
const db = require("../db");
const employeeReferrals = require("../services/employeeReferrals");
const channelLog = require("../services/channelLog");
const notify = require("../services/notify");

const REASONS = {
  app_not_opened: "не открыл приложение",
  left_channel: "вышел из канала",
  blocked_bot: "заблокировал бота"
};

async function runEmployeeReferralChecks() {
  // Фаза A - решение по рефералам, у которых истекли сутки проверки.
  const { rows: pending } = await db.query(
    `SELECT r.id, r.employee_id, r.user_id, u.app_opened, u.channel_member, u.tg_unreachable
       FROM employee_referrals r
       JOIN users u ON u.id = r.user_id
      WHERE r.status = 'pending' AND r.created_at <= NOW() - interval '24 hours'`
  );

  let confirmed = 0;
  let rejected = 0;
  for (const r of pending) {
    let reason = null;
    if (!r.app_opened) reason = "app_not_opened";
    else if (!r.channel_member) reason = "left_channel";
    else if (r.tg_unreachable) reason = "blocked_bot";
    const status = reason ? "rejected" : "confirmed";

    // Guard по status='pending' - защита от гонки с параллельным запуском.
    const upd = await db.query(
      `UPDATE employee_referrals SET status = $2, reject_reason = $3, decided_at = NOW()
        WHERE id = $1 AND status = 'pending' RETURNING id`,
      [r.id, status, reason]
    );
    if (!upd.rows.length) continue;
    if (reason) rejected++; else confirmed++;

    // В лог-канал - итог по каждому (владелец видит имена; сотруднику ЛС не шлём,
    // он видит результат в /stat).
    try {
      const who = await notify.userLabel(r.user_id);
      const empRow = await db.query("SELECT user_id FROM employees WHERE id = $1", [r.employee_id]);
      const empWho = empRow.rows[0] ? await notify.userLabel(empRow.rows[0].user_id) : "?";
      channelLog.post(
        "employees",
        reason
          ? `❌ <b>Сотрудник: реферал отклонён</b>\n\nРеферал ${who} сотрудника ${empWho} не прошёл проверку 24 ч: ${REASONS[reason]}.`
          : `✅ <b>Сотрудник: реферал засчитан</b>\n\nРеферал ${who} сотрудника ${empWho} прошёл проверку 24 ч.`
      ).catch(() => {});
    } catch (e) {
      console.error("[empRef job] log:", e.message);
    }
  }
  if (pending.length) {
    console.log(`[cron] employeeReferrals: confirmed=${confirmed} rejected=${rejected}`);
  }

  // Фаза B - reconcile оплат.
  const attributed = await employeeReferrals.attributePaymentsSince("2 days");
  if (attributed) console.log(`[cron] employeeReferrals: attributed=${attributed}`);
}

module.exports = { runEmployeeReferralChecks };
