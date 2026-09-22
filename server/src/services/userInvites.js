// Пользовательские приглашения «Пригласи друга»: у каждого юзера короткая ссылка
// t.me/<бот>?start=<invite_code>, учёт переходов и приглашённых, статистика для
// экрана /invite в мини-аппе и для админки.
// Правило зачёта то же, что у сотрудников-пиарщиков: приглашением становится только
// НОВЫЙ пользователь (не сам приглашающий); подтверждение через 24 часа делает
// jobs/userInvites.js. Денег здесь нет - награда за конкурс выдаётся вручную из админки.
// Даты в статистике считаются по Москве, чтобы цифры у владельца и юзера совпадали.
const db = require("../db");
const { sendMessage } = require("./telegram");
const channelLog = require("./channelLog");
const notify = require("./notify");

const TZ = "Europe/Moscow";
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "Bytwise_bot";

// Причины отказа - те же коды, что у сотрудников (jobs/employeeReferrals.js),
// плюс формулировки для ЛС приглашающему.
const REASONS = {
  app_not_opened: "не открыл приложение",
  left_channel: "вышел из канала",
  blocked_bot: "заблокировал бота"
};

function buildLink(code) {
  return `https://t.me/${BOT_USERNAME}?start=${code}`;
}

// Пользователь по коду из ссылки. Регистр не важен: код диктуют и перепечатывают руками.
async function getByInviteCode(code) {
  if (!code) return null;
  const { rows } = await db.query(
    "SELECT id, telegram_id, name, username FROM users WHERE LOWER(invite_code) = LOWER($1)",
    [code]
  );
  return rows[0] || null;
}

// ЛС пользователю по users.id. Ошибки доставки не роняют основной поток.
async function dm(userId, text) {
  try {
    const { rows } = await db.query("SELECT telegram_id FROM users WHERE id = $1", [userId]);
    if (!rows[0]) return;
    await sendMessage(rows[0].telegram_id, text);
  } catch (e) {
    console.error("[invites] dm:", e.message);
  }
}

// Переход по пользовательской ссылке из /start. Вызывается fire-and-forget из bot.start.
// userRow - результат registerStartUser: содержит id и inserted (новый ли пользователь).
async function handleStartLink({ code, from, userRow }) {
  if (!code || !userRow) return;
  const inviter = await getByInviteCode(code);
  if (!inviter) return; // неизвестный код - молчим, как на любую неизвестную команду

  const isSelf = Number(inviter.id) === Number(userRow.id);
  const eligible = userRow.inserted === true && !isSelf;

  // Переход фиксируем всегда - на экране приглашений видна воронка «перешли → засчитаны».
  await db.query(
    "INSERT INTO user_invite_clicks (inviter_id, telegram_id, existing_user) VALUES ($1, $2, $3)",
    [inviter.id, from?.id || null, !eligible]
  );
  if (!eligible) return;

  const ins = await db.query(
    `INSERT INTO user_invites (inviter_id, user_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING RETURNING id`,
    [inviter.id, userRow.id]
  );
  if (!ins.rows.length) return; // человека уже привёл кто-то другой

  // Приглашающему - только факт, без личных данных приведённого.
  dm(inviter.id,
    "👥 <b>По твоей ссылке пришёл друг!</b>\n" +
    "Пока на проверке: засчитается через 24 часа, если он откроет приложение, " +
    "вступит в канал и не уйдёт.").catch(() => {});

  const who = await notify.userLabel(userRow.id);
  const inviterWho = await notify.userLabel(inviter.id);
  channelLog.post(
    "invites",
    `👥 <b>Приглашение: новый друг</b>\n\n` +
    `${inviterWho} привёл ${who}.\n` +
    `Статус: на проверке (24 ч).\n` +
    `Время: ${notify.fmtWhen()}`
  ).catch(() => {});
}

// Цифры приглашающего: переходы по ссылке и приглашённые за день (календарный, МСК) /
// 7 дней / 30 дней + итоги по статусам. Используется и в мини-аппе, и в админке.
async function statsForUser(userId) {
  const params = [userId, TZ];
  const dayCond = (col) => `(${col} AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date`;

  const clicksQ = db.query(
    `SELECT COUNT(*) FILTER (WHERE ${dayCond("clicked_at")})::int AS day,
            COUNT(*) FILTER (WHERE clicked_at >= NOW() - interval '7 days')::int AS week,
            COUNT(*) FILTER (WHERE clicked_at >= NOW() - interval '30 days')::int AS month,
            COUNT(*)::int AS total
       FROM user_invite_clicks WHERE inviter_id = $1`, params);
  // Периоды считают ПРИШЕДШИХ (не отклонённых): подтверждение идёт через 24 ч,
  // поэтому «засчитанные за день» были бы всегда 0. Итоги по статусам - точные.
  const invitesQ = db.query(
    `SELECT COUNT(*) FILTER (WHERE status <> 'rejected' AND ${dayCond("created_at")})::int AS day,
            COUNT(*) FILTER (WHERE status <> 'rejected' AND created_at >= NOW() - interval '7 days')::int AS week,
            COUNT(*) FILTER (WHERE status <> 'rejected' AND created_at >= NOW() - interval '30 days')::int AS month,
            COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
            COUNT(*)::int AS total
       FROM user_invites WHERE inviter_id = $1`, params);

  const [clicks, invites] = await Promise.all([clicksQ, invitesQ]);
  return { clicks: clicks.rows[0], invites: invites.rows[0] };
}

// Топ участников розыгрыша за всё время: «приглашено / зачтено».
// Приглашено - все строки, кроме отклонённых (то есть засчитанные + ждущие проверки),
// зачтено - только confirmed. Порядок тот же, что в админке: по зачтённым, при равенстве
// выше тот, кто привёл больше людей всего. Используется командой «.розыгрыш» в канале логов.
async function leaderboard(limit = 6) {
  const n = Math.max(1, Math.min(100, Number(limit) || 6));
  const { rows } = await db.query(
    `SELECT u.id, u.telegram_id, u.name, u.username,
            COUNT(*) FILTER (WHERE i.status <> 'rejected')::int AS invited,
            COUNT(*) FILTER (WHERE i.status = 'confirmed')::int AS confirmed
       FROM user_invites i JOIN users u ON u.id = i.inviter_id
      GROUP BY u.id
     HAVING COUNT(*) FILTER (WHERE i.status <> 'rejected') > 0
      ORDER BY confirmed DESC, invited DESC, u.id ASC
      LIMIT $1`,
    [n]
  );
  return rows;
}

// Итог проверки 24 ч - ЛС приглашающему. Зовётся из jobs/userInvites.js.
// Имя приглашённого не раскрываем: приглашающий видит только свои цифры.
async function notifyDecided(inviterId, status, reason) {
  const text = status === "confirmed"
    ? "✅ <b>Друг засчитан!</b>\nОн прошёл проверку 24 часов. Статистика - в приложении, «Профиль → Пригласить друга»."
    : `❌ <b>Друг не засчитан</b>\nПроверку 24 часов он не прошёл: ${REASONS[reason] || "не выполнил условия"}.`;
  await dm(inviterId, text);
}

module.exports = {
  TZ,
  REASONS,
  buildLink,
  getByInviteCode,
  handleStartLink,
  statsForUser,
  leaderboard,
  notifyDecided
};
