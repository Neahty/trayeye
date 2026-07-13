// Сотрудники-пиарщики: персональные ссылки emp_<code>, учёт переходов, рефералов
// и их оплат, статистика для /stat и админки, уведомления в ЛС и лог-канал.
// Правила зачёта: рефералом становится только НОВЫЙ пользователь (не сам сотрудник
// и не другой сотрудник); подтверждение через 24 часа делает jobs/employeeReferrals.js.
// Все даты в статистике считаются по Москве — у владельца и сотрудников цифры совпадают.
const db = require("../db");
const { sendMessage } = require("./telegram");
const channelLog = require("./channelLog");
const notify = require("./notify");

const TZ = "Europe/Moscow";
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "Bytwise_bot";

function buildLink(code) {
  return `https://t.me/${BOT_USERNAME}?start=emp_${code}`;
}

// Активный сотрудник по telegram_id — гейт для /ref и /stat (уволенным команды молчат).
async function getActiveEmployeeByTg(telegramId) {
  if (!telegramId) return null;
  const { rows } = await db.query(
    `SELECT e.*, u.telegram_id, u.name, u.username
       FROM employees e JOIN users u ON u.id = e.user_id
      WHERE u.telegram_id = $1 AND e.active = TRUE`,
    [telegramId]
  );
  return rows[0] || null;
}

// ЛС сотруднику по users.id. Ошибки доставки не роняют основной поток.
async function dm(userId, text) {
  try {
    const { rows } = await db.query("SELECT telegram_id FROM users WHERE id = $1", [userId]);
    if (!rows[0]) return;
    await sendMessage(rows[0].telegram_id, text);
  } catch (e) {
    console.error("[empRef] dm:", e.message);
  }
}

// Переход по ссылке emp_<code> из /start. Вызывается fire-and-forget из bot.start.
// userRow — результат registerStartUser: содержит id и inserted (новый ли пользователь).
async function handleStartLink({ code, from, userRow }) {
  if (!code || !userRow) return;
  const { rows } = await db.query(
    "SELECT * FROM employees WHERE code = $1 AND active = TRUE",
    [code]
  );
  const emp = rows[0];
  if (!emp) return; // неизвестный код или уволенный сотрудник — ссылка погашена

  const isSelf = Number(userRow.id) === Number(emp.user_id);
  const { rows: empRows } = await db.query("SELECT 1 FROM employees WHERE user_id = $1", [userRow.id]);
  const eligible = userRow.inserted === true && !isSelf && !empRows.length;

  // Переход фиксируем всегда — сотрудник видит воронку «перешли → засчитаны».
  await db.query(
    "INSERT INTO employee_link_clicks (employee_id, telegram_id, existing_user) VALUES ($1, $2, $3)",
    [emp.id, from?.id || null, !eligible]
  );
  if (!eligible) return;

  const ins = await db.query(
    `INSERT INTO employee_referrals (employee_id, user_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING RETURNING id`,
    [emp.id, userRow.id]
  );
  if (!ins.rows.length) return;

  // Сотруднику — только факт, без личных данных приведённого.
  dm(emp.user_id,
    "👥 <b>Новый человек по твоей ссылке!</b>\n" +
    "Пока на проверке: засчитается через 24 часа, если он откроет приложение, " +
    "вступит в канал и не уйдёт.").catch(() => {});
  const who = await notify.userLabel(userRow.id);
  const empWho = await notify.userLabel(emp.user_id);
  channelLog.post(
    "employees",
    `👥 <b>Сотрудник: новый реферал</b>\n\n` +
    `Сотрудник ${empWho} привёл ${who}.\n` +
    `Статус: на проверке (24 ч).\n` +
    `Время: ${notify.fmtWhen()}`
  ).catch(() => {});
}

// Атрибуция оплат рефералов сотрудникам. Идемпотентна (UNIQUE payment_id):
// зовётся и после fulfillPayment, и ежечасно из крона (страховка от падений,
// плюс ловит ручные начисления админом — они тоже создают строку в payments).
// Оплаты pending-рефералов засчитываются; отклонённых — нет.
async function attributePaymentsSince(interval = "2 days") {
  const { rows } = await db.query(
    `INSERT INTO employee_payments (employee_id, referral_id, payment_id, amount)
     SELECT r.employee_id, r.id, p.id, COALESCE(p.amount, 0)
       FROM payments p
       JOIN employee_referrals r ON r.user_id = p.user_id AND r.status <> 'rejected'
      WHERE p.status = 'succeeded' AND p.created_at > NOW() - $1::interval
     ON CONFLICT (payment_id) DO NOTHING
     RETURNING employee_id, referral_id, amount`,
    [interval]
  );
  for (const row of rows) {
    try {
      const { rows: e } = await db.query("SELECT * FROM employees WHERE id = $1", [row.employee_id]);
      const emp = e[0];
      if (!emp) continue;
      if (emp.active) {
        dm(emp.user_id, `💳 <b>Твой реферал оплатил подписку — ${row.amount} ₽!</b>\nОплата засчитана, детали в /stat.`).catch(() => {});
      }
      const empWho = await notify.userLabel(emp.user_id);
      const { rows: r } = await db.query("SELECT user_id FROM employee_referrals WHERE id = $1", [row.referral_id]);
      const who = r[0] ? await notify.userLabel(r[0].user_id) : "пользователь";
      channelLog.post(
        "employees",
        `💳 <b>Сотрудник: реферал оплатил подписку</b>\n\n` +
        `Реферал ${who} сотрудника ${empWho} оплатил ${row.amount} ₽.\n` +
        `Время: ${notify.fmtWhen()}`
      ).catch(() => {});
    } catch (err) {
      console.error("[empRef] attribute notify:", err.message);
    }
  }
  return rows.length;
}

// Цифры сотрудника: за день (календарный, МСК) / 7 дней / 30 дней + итоги
// выплачено/не выплачено. Используется и в /stat бота, и в карточке админки.
async function statsForEmployee(employeeId) {
  const params = [employeeId, TZ];
  const dayCond = (col) => `(${col} AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date`;

  const clicksQ = db.query(
    `SELECT COUNT(*) FILTER (WHERE ${dayCond("clicked_at")})::int AS day,
            COUNT(*) FILTER (WHERE clicked_at >= NOW() - interval '7 days')::int AS week,
            COUNT(*) FILTER (WHERE clicked_at >= NOW() - interval '30 days')::int AS month,
            COUNT(*)::int AS total
       FROM employee_link_clicks WHERE employee_id = $1`, params);
  // Периоды считают ПРИШЕДШИХ (не отклонённых): подтверждение происходит через 24 ч,
  // поэтому «засчитанные за день» были бы всегда 0. Итоги (confirmed/pending) — точные.
  const refsQ = db.query(
    `SELECT COUNT(*) FILTER (WHERE status <> 'rejected' AND ${dayCond("created_at")})::int AS day,
            COUNT(*) FILTER (WHERE status <> 'rejected' AND created_at >= NOW() - interval '7 days')::int AS week,
            COUNT(*) FILTER (WHERE status <> 'rejected' AND created_at >= NOW() - interval '30 days')::int AS month,
            COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
            COUNT(*) FILTER (WHERE status = 'confirmed' AND payout_id IS NOT NULL)::int AS paid,
            COUNT(*) FILTER (WHERE status = 'confirmed' AND payout_id IS NULL)::int AS unpaid
       FROM employee_referrals WHERE employee_id = $1`, params);
  const paysQ = db.query(
    `SELECT COUNT(*) FILTER (WHERE ${dayCond("created_at")})::int AS day,
            COUNT(*) FILTER (WHERE created_at >= NOW() - interval '7 days')::int AS week,
            COUNT(*) FILTER (WHERE created_at >= NOW() - interval '30 days')::int AS month,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE payout_id IS NOT NULL)::int AS paid,
            COUNT(*) FILTER (WHERE payout_id IS NULL)::int AS unpaid,
            COALESCE(SUM(amount), 0)::int AS revenue
       FROM employee_payments WHERE employee_id = $1`, params);
  const payoutsQ = db.query(
    `SELECT COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0)::int AS paid_total
       FROM employee_payouts WHERE employee_id = $1`, [employeeId]);

  const [clicks, refs, pays, payouts] = await Promise.all([clicksQ, refsQ, paysQ, payoutsQ]);
  return {
    clicks: clicks.rows[0],
    referrals: refs.rows[0],
    payments: pays.rows[0],
    payouts: payouts.rows[0]
  };
}

// --- Уведомления (ЛС сотруднику + дубль в лог-канал, тумблер «employees») ---

async function notifyGranted(emp) {
  dm(emp.user_id,
    "🎉 <b>Тебе выдана роль сотрудника Bytwise!</b>\n\n" +
    "Команды:\n" +
    "/ref — твоя личная ссылка и правила зачёта\n" +
    "/stat — твоя статистика и выплаты").catch(() => {});
  const empWho = await notify.userLabel(emp.user_id);
  channelLog.post(
    "employees",
    `🧑‍💼 <b>Сотрудник: выдана роль</b>\n\n` +
    `${empWho} назначен сотрудником-пиарщиком.\n` +
    `Ссылка: ${channelLog.esc(buildLink(emp.code))}\n` +
    `Время: ${notify.fmtWhen()}`
  ).catch(() => {});
}

function kindLabel(kind) {
  return kind === "subscriptions" ? "оплаченные подписки" : "приведённых людей";
}

async function notifyPayout(emp, payout) {
  const unit = payout.kind === "subscriptions" ? "подписок" : "чел.";
  dm(emp.user_id,
    `💰 <b>Тебе выплачено!</b>\n\n` +
    `За ${kindLabel(payout.kind)}: ${payout.unit_count} ${unit} × ${payout.unit_rate} ₽ = <b>${payout.total} ₽</b>`).catch(() => {});
  const empWho = await notify.userLabel(emp.user_id);
  channelLog.post(
    "employees",
    `💰 <b>Сотрудник: выплата</b>\n\n` +
    `Сотруднику ${empWho} выплачено за ${kindLabel(payout.kind)}: ` +
    `${payout.unit_count} × ${payout.unit_rate} ₽ = <b>${payout.total} ₽</b>\n` +
    `Время: ${notify.fmtWhen()}`
  ).catch(() => {});
}

async function notifyPayoutCancelled(emp, payout) {
  dm(emp.user_id,
    `↩️ <b>Выплата отменена</b>\n\n` +
    `Отменена выплата за ${kindLabel(payout.kind)} на ${payout.total} ₽ — она была отмечена по ошибке. ` +
    `Эти единицы снова числятся как невыплаченные.`).catch(() => {});
  const empWho = await notify.userLabel(emp.user_id);
  channelLog.post(
    "employees",
    `↩️ <b>Сотрудник: выплата отменена</b>\n\n` +
    `У сотрудника ${empWho} отменена выплата ${payout.total} ₽ (за ${kindLabel(payout.kind)}).\n` +
    `Время: ${notify.fmtWhen()}`
  ).catch(() => {});
}

module.exports = {
  TZ,
  buildLink,
  getActiveEmployeeByTg,
  handleStartLink,
  attributePaymentsSince,
  statsForEmployee,
  notifyGranted,
  notifyPayout,
  notifyPayoutCancelled
};
