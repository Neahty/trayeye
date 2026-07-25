const db = require("../db");
const { sendMessage, getUserProfilePhotoFileId } = require("./telegram");
const settings = require("../utils/settings");
const channelLog = require("./channelLog");

// Название тарифа по его id. Сначала — реальное название из настроек (динамически),
// затем запасные варианты, если настроек нет.
async function tariffTitle(type) {
  try {
    const list = await settings.get("tariffs");
    const t = Array.isArray(list) ? list.find((x) => x && x.id === type) : null;
    if (t?.title) return t.title;
  } catch { /* нет настроек — отдаём дефолт ниже */ }
  if (type === "trainer") return "Тренерская";
  return "PRO";
}

// Время для админских уведомлений — в том же поясе, что и админка (МСК+2, без перехода на лето).
function fmtWhen(when) {
  const d = when ? new Date(when) : new Date();
  try {
    return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Yekaterinburg" });
  } catch { return d.toISOString(); }
}

async function getTelegramId(userId) {
  const { rows } = await db.query("SELECT telegram_id, notifications_enabled FROM users WHERE id = $1", [userId]);
  return rows[0] || null;
}

// Тренеру: клиент добавил запись о питании
async function notifyTrainerOfClientScan(clientUser) {
  const { rows } = await db.query(
    "SELECT trainer_id FROM trainer_clients WHERE client_id = $1",
    [clientUser.id]
  );
  if (!rows.length) return;
  const trainer = await getTelegramId(rows[0].trainer_id);
  if (!trainer || !trainer.notifications_enabled) return;
  const clientName = clientUser.name || clientUser.username || "Клиент";
  await sendMessage(trainer.telegram_id, `📋 ${clientName} добавил запись о питании`);
}

// Клиенту: тренер оставил комментарий
async function notifyClientOfComment(clientId) {
  const client = await getTelegramId(clientId);
  if (!client || !client.notifications_enabled) return;
  await sendMessage(client.telegram_id, "💬 Тренер оставил комментарий к вашей записи");
}

// --- Уведомления по платежам ---

function adminIds() {
  return (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function notifyAdmins(text) {
  for (const id of adminIds()) {
    try { await sendMessage(id, text); } catch { /* одного админа не достучались — не падаем */ }
  }
}

// --- Лог «Новый пользователь» ---

const GENDER_LABELS = { male: "Мужской", female: "Женский" };
const NEW_USER_FIELDS = "telegram_id, name, username, gender, age, height, weight, channel_joined_at";

// Подпись «кто» по уже загруженной строке пользователя — без лишнего запроса в БД.
function whoOf(u) {
  if (u.username) return `@${esc(u.username)}`;
  return `<a href="tg://user?id=${u.telegram_id}">${esc(u.name || "Пользователь")}</a>`;
}

// NUMERIC из БД приходит строкой («75.00») — показываем по-человечески: 75, 75.5.
function num(v) {
  return v == null || Number.isNaN(Number(v)) ? null : String(Number(v));
}

// Текст лога. Пока онбординг не пройден — короткий вариант, после — с анкетой.
// Время всегда исходное (момент подписки), даже когда правим сообщение позже.
function newUserText(u, source, withProfile) {
  const action = source === "app" ? "впервые открыл приложение" : "подписался на канал и открыл бота";
  const profile = withProfile
    ? `Пол: ${GENDER_LABELS[u.gender] || "—"}\n` +
      `Возраст: ${u.age ? `${u.age} лет` : "—"}\n` +
      `Рост: ${u.height ? `${u.height} см` : "—"}\n` +
      `Вес: ${num(u.weight) ? `${num(u.weight)} кг` : "—"}\n`
    : "";
  return (
    `👤 <b>Новый пользователь</b>\n\n` +
    `${whoOf(u)} ${action}.\n` +
    profile +
    `Время: ${fmtWhen(u.channel_joined_at)}`
  );
}

// Новый пользователь появился в боте/приложении.
// Админам в личку — короткая строка; в канал — то же самое, но с аватаркой человека
// (той, что служит ему фото в Bytwise) и с дозаписью анкеты после онбординга
// (см. refreshNewUserLog). Ссылку на сообщение в канале сохраняем в users.
// source: "channel" (подписался на обязательный канал — основной триггер)
//       | "app" (впервые открыл приложение).
async function notifyNewUser(userId, source = "channel") {
  const { rows } = await db.query(`SELECT ${NEW_USER_FIELDS} FROM users WHERE id = $1`, [userId]);
  const u = rows[0];
  if (!u) return;
  const text = newUserText(u, source, false);
  await notifyAdmins(text);

  // Аватарка берётся живым запросом: в момент подписки кэш tg_photo_path ещё не заполнен
  // (avatarSync отрабатывает только на входе в приложение).
  const photo = await getUserProfilePhotoFileId(u.telegram_id).catch(() => null);
  const res = photo
    ? await channelLog.postPhotoFor("users", userId, photo, text)
    : await channelLog.postFor("users", userId, text);

  // Лог мог не уйти (канал выключен в админке / бот не админ канала) — тогда и править нечего.
  const msg = res?.result;
  if (!msg?.message_id) return;
  await db.query("UPDATE users SET tg_log_new_user_msg = $2 WHERE id = $1", [
    userId,
    JSON.stringify({ chat_id: msg.chat?.id, message_id: msg.message_id, kind: photo ? "photo" : "text", source })
  ]);
}

// Онбординг пройден — дописываем анкету в то же сообщение канала (нового не шлём).
async function refreshNewUserLog(userId) {
  const { rows } = await db.query(
    `SELECT ${NEW_USER_FIELDS}, tg_log_new_user_msg FROM users WHERE id = $1`,
    [userId]
  );
  const u = rows[0];
  const ref = u?.tg_log_new_user_msg;
  if (!ref?.chat_id || !ref?.message_id) return;
  const text = newUserText(u, ref.source, true);
  // Фото и текст правятся разными методами Bot API — какой отправляли, таким и правим.
  if (ref.kind === "photo") await channelLog.editCaption("users", ref.chat_id, ref.message_id, text);
  else await channelLog.editText("users", ref.chat_id, ref.message_id, text);
}

// Экранирование для parse_mode: HTML, чтобы спецсимволы в имени не ломали сообщение.
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Человекочитаемая подпись пользователя для админских сообщений.
// Приоритет — кликабельный @username. Если username нет — кликабельное имя по tg-ссылке.
async function userLabel(userId) {
  const { rows } = await db.query("SELECT telegram_id, name, username FROM users WHERE id = $1", [userId]);
  const u = rows[0];
  if (!u) return `Пользователь #${userId}`;
  if (u.username) return `@${esc(u.username)}`;
  const nm = esc(u.name || "Пользователь");
  return `<a href="tg://user?id=${u.telegram_id}">${nm}</a>`;
}

// Успешная оплата: пользователю — подтверждение, админам — уведомление о покупке.
// renewal=true — повторная оплата (продление): другой заголовок и отдельный тип лога.
async function notifyPurchase(userId, { amount, type, renewal = false } = {}) {
  const title = esc(await tariffTitle(type));
  const user = await getTelegramId(userId);
  if (user) {
    try {
      await sendMessage(
        user.telegram_id,
        renewal
          ? `✅ Подписка <b>Bytwise ${title}</b> продлена!\nСпасибо, что остаёшься с нами 💜 Доступ ко всем функциям сохранён.`
          : `✅ Подписка <b>Bytwise ${title}</b> успешно оформлена!\nСпасибо за поддержку 💜 Все функции уже доступны — открывай приложение.`
      );
    } catch { /* пользователь мог не нажать Start / заблокировать бота */ }
  }
  const who = await userLabel(userId);
  const text = renewal
    ? `🔁 <b>Продление подписки</b>\n\n` +
      `Клиент ${who} продлил подписку. Деньги получены, доступ продлён.\n\n` +
      `Подписка: <b>${title}</b>\n` +
      `Сумма: ${amount ?? "—"} ₽\n` +
      `Время: ${fmtWhen()}`
    : `💰 <b>Новая подписка — оплата прошла</b>\n\n` +
      `Клиент ${who} оплатил подписку. Деньги получены, доступ уже открыт.\n\n` +
      `Подписка: <b>${title}</b>\n` +
      `Сумма: ${amount ?? "—"} ₽\n` +
      `Время: ${fmtWhen()}`;
  await notifyAdmins(text);
  // Продления — отдельный тумблер в логах; если он выключен, такие события не засоряют канал.
  channelLog.postFor(renewal ? "subscription_renew" : "payments", userId, text).catch(() => {});
}

// Платёж не завершён (отменён/не оплачен) — подробное уведомление админам простыми словами.
// when — момент НАЧАЛА оплаты (created_at заказа). Само сообщение приходит позже: ЮKassa
// присылает отмену неоплаченного заказа с задержкой (обычно через 1–2 часа), а не сразу при выходе.
async function notifyPaymentFailed(userId, { amount, type, when } = {}) {
  // Не пугаем «не завершён», если человек в итоге всё же оформил подписку
  // (мог оплатить со второй попытки — тогда отмена старого заказа уже не важна).
  if (userId) {
    const act = await db.query(
      "SELECT 1 FROM subscriptions WHERE user_id = $1 AND status = 'active' AND expires_at > NOW() LIMIT 1",
      [userId]
    );
    if (act.rows.length) return;
  }
  const who = userId ? await userLabel(userId) : "клиент";
  const title = esc(await tariffTitle(type));
  const text =
    `❌ <b>Платёж не завершён</b>\n\n` +
    `Клиент ${who} открыл окно оплаты, но не довёл её до конца — закрыл, передумал или не оплатил ` +
    `до истечения заказа. Деньги не списаны, это не ошибка.\n\n` +
    `Подписка: <b>${title}</b>\n` +
    `${amount != null ? `Сумма: ${amount} ₽\n` : ""}` +
    `Начал оплату: ${fmtWhen(when)}\n` +
    `<i>ЮKassa сообщает об отмене неоплаченного заказа с задержкой, поэтому это сообщение ` +
    `приходит через 1–2 часа после самого выхода — время выше показывает, когда человек начинал оплату.</i>`;
  await notifyAdmins(text);
  channelLog.postFor("payments", userId, text).catch(() => {});
}

// Возврат платежа — подробное уведомление админам.
async function notifyRefund(userId, { amount, type, when } = {}) {
  const who = userId ? await userLabel(userId) : "клиент";
  const title = esc(await tariffTitle(type));
  const text =
    `↩️ <b>Возврат платежа</b>\n\n` +
    `Клиенту ${who} вернули деньги за подписку. Сумма ушла обратно на его карту, ` +
    `доступ по этой оплате закрыт.\n\n` +
    `Подписка: <b>${title}</b>\n` +
    `${amount != null ? `Сумма: ${amount} ₽\n` : ""}` +
    `Время: ${fmtWhen(when)}`;
  await notifyAdmins(text);
  channelLog.postFor("payments", userId, text).catch(() => {});
}

// --- Уведомления тренер ↔ клиент ---

// Подпись по объекту пользователя (без запроса в БД): @username или имя.
function labelOf(u) {
  if (!u) return "пользователь";
  if (u.username) return `@${esc(u.username)}`;
  return esc(u.name || "пользователь");
}

// Клиенту — он подключён к тренеру (доступ открыт).
async function notifyClientConnected(clientId, trainer) {
  const client = await getTelegramId(clientId);
  if (!client) return;
  try {
    await sendMessage(
      client.telegram_id,
      `🤝 Вы подключены к тренеру ${labelOf(trainer)}.\nДоступ к Bytwise PRO открыт, пока активна подписка тренера.`
    );
  } catch { /* клиент мог не нажать Start */ }
}

// Тренеру — к нему подключился новый клиент.
async function notifyTrainerNewClient(trainerId, clientId) {
  const trainer = await getTelegramId(trainerId);
  if (!trainer) return;
  const who = await userLabel(clientId);
  try {
    await sendMessage(trainer.telegram_id, `🙋 К вам подключился новый клиент: ${who}`);
  } catch { /* тренер мог не нажать Start */ }
}

module.exports = {
  notifyTrainerOfClientScan,
  notifyClientOfComment,
  notifyAdmins,
  notifyNewUser,
  refreshNewUserLog,
  notifyPurchase,
  notifyPaymentFailed,
  notifyRefund,
  notifyClientConnected,
  notifyTrainerNewClient,
  // Утилиты для переиспользования в других логах (channelMembership и т.п.).
  userLabel,
  fmtWhen
};
