// Логи ИСХОДЯЩИХ уведомлений в Telegram-канал: что бот только что разослал людям.
// Раньше в канал попадали только события «что случилось» (оплатил, написал, вышел),
// а сами рассылки шли молча — владелец узнавал о них только из админки.
//
// Два режима, по охвату события:
//   • сводки массовых рассылок (mealRun / subscriptionRun / broadcastRun) — прогон закончился,
//     пишем одну сводку с цифрами и БЕЗ перечисления людей: «разослали 128 напоминаний про
//     завтрак», а не 128 сообщений в канал;
//   • всё остальное — уведомление одному человеку: пишем в канал в тот же момент, когда оно
//     ушло получателю, и с именем. Сообщение привязано к тому, КОМУ оно ушло (`postFor`),
//     поэтому на него работает реплай `.запретить` из logModeration.
//
// Ошибки отправки гасит channelLog — лог не должен ронять сами уведомления.
const channelLog = require("./channelLog");

// notify сам зовёт notifyLog, поэтому тянем его по месту — на верхнем уровне был бы цикл require.
function notify() {
  return require("./notify");
}

const esc = channelLog.esc;

// Русское склонение: 1 человек / 2 человека / 5 человек.
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function people(n) {
  return `${n} ${plural(n, "человек", "человека", "человек")}`;
}

// Строка про недошедшие сообщения — только когда есть о чём сказать.
function undelivered(failed = 0, blocked = 0) {
  if (!failed) return "";
  return `⚠️ Не дошло: ${failed}${blocked ? ` (${blocked} — бот у них в чёрном списке)` : ""}\n`;
}

// Итоговая строка со временем — одинаковый хвост у всех сообщений раздела.
function when() {
  return `Время: ${notify().fmtWhen()}`;
}

// --- Сводки массовых рассылок ---

const MEAL_LABELS = {
  breakfast: "🥞 Завтрак",
  lunch: "🍲 Обед",
  dinner: "🌙 Ужин"
};

// Итог прогона напоминаний о еде. Пустые прогоны молчат: крон ходит каждый час, а час
// отправки у каждого свой — иначе канал получал бы два десятка пустых сводок в сутки.
async function mealRun({ byMeal = {}, failed = 0, blocked = 0 } = {}) {
  const total = Object.values(byMeal).reduce((a, b) => a + b, 0);
  if (!total) return;
  const lines = Object.entries(MEAL_LABELS)
    .filter(([meal]) => byMeal[meal])
    .map(([meal, label]) => `${label}: ${people(byMeal[meal])}`);
  await channelLog.post(
    "notify_meals",
    `🍽 <b>Разослали напоминания поесть</b>\n\n` +
    `Всего: ${people(total)}\n` +
    `${lines.join("\n")}\n` +
    undelivered(failed, blocked) +
    when()
  );
}

// Ключи — как в reminders.texts, чтобы сводка одинаково читалась и для крона, и для
// ручной рассылки («Разослать сейчас»), где внутренние kind'ы другие.
const SUB_LABELS = {
  trial_start: "🎁 Пробный период начался",
  trial_end: "⏳ Последний день пробного",
  trial_post: "🚪 Пробный кончился — зовём купить",
  paid_pre: "📅 Подписка скоро кончится — зовём продлить",
  paid_post: "🔒 Подписка кончилась — зовём вернуться"
};

// Итог прогона напоминаний о подписке/пробном. blast — ручная рассылка из админки.
async function subscriptionRun({ byKind = {}, failed = 0, blocked = 0, blast = false } = {}) {
  const total = Object.values(byKind).reduce((a, b) => a + b, 0);
  if (!total) return;
  const lines = Object.entries(SUB_LABELS)
    .filter(([key]) => byKind[key])
    .map(([key, label]) => `${label}: ${people(byKind[key])}`);
  await channelLog.post(
    "notify_subscription",
    (blast
      ? `🔔 <b>Ручная рассылка про подписку</b>\n\n`
      : `🔔 <b>Разослали напоминания про подписку</b>\n\n`) +
    `Всего: ${people(total)}\n` +
    `${lines.join("\n")}\n` +
    undelivered(failed, blocked) +
    when()
  );
}

// Подписи аудиторий и форматов — те же, что видит админ в разделе «Уведомления».
const AUDIENCE_LABELS = {
  all: "все пользователи",
  subscribed: "с подпиской",
  unsubscribed: "без подписки",
  new: "новые (7 дней)",
  expiring: "подписка скоро кончится",
  churned: "отписавшиеся",
  sub_basic: "тариф PRO",
  sub_trainer: "тариф Тренерская",
  inactive: "не активированные",
  user: "выбранные вручную"
};

const BROADCAST_KIND_LABELS = { text: "текст", photo: "фото с подписью", buttons: "текст с кнопками" };

const PREVIEW_LIMIT = 200;

// Итог ручной рассылки из админки: кому, чем и сколько дошло. Текст даём куском —
// по нему сразу видно, что именно ушло людям.
async function broadcastRun(broadcast, { sent = 0, delivered = 0 } = {}) {
  const raw = String(broadcast.text || "").trim().replace(/\s+/g, " ");
  const preview = raw.length > PREVIEW_LIMIT ? `${raw.slice(0, PREVIEW_LIMIT)}…` : raw;
  await channelLog.post(
    "notify_broadcast",
    `📣 <b>Отправили рассылку из админки</b>\n\n` +
    `Кому: ${AUDIENCE_LABELS[broadcast.audience] || esc(broadcast.audience)}\n` +
    `Формат: ${BROADCAST_KIND_LABELS[broadcast.kind] || esc(broadcast.kind)}\n` +
    `Получателей: ${sent} · дошло: ${delivered}\n` +
    (preview ? `Текст: «${esc(preview)}»\n` : "") +
    when()
  );
}

// --- Точечные уведомления конкретному человеку ---

// Догонялка тому, кто открыл окно оплаты и не купил.
async function abandonedCart(userId, { tariff, price } = {}) {
  const who = await notify().userLabel(userId);
  await channelLog.postFor(
    "notify_personal",
    userId,
    `🛒 <b>Отправили догонялку по брошенной оплате</b>\n\n` +
    `${who} открыл оплату и не купил — написали ему с кнопкой «Оформить подписку».\n` +
    `Тариф: <b>${esc(tariff || "—")}</b>${price != null ? ` · ${price} ₽` : ""}\n` +
    when()
  );
}

// Апселл, когда у человека на пробном кончились бесплатные сканы за сегодня.
async function limitPush(userId, { limit, daysLeft } = {}) {
  const who = await notify().userLabel(userId);
  await channelLog.postFor(
    "notify_personal",
    userId,
    `🚀 <b>Отправили предложение оформить PRO</b>\n\n` +
    `У ${who} кончились бесплатные сканы на сегодня (${limit} в день)` +
    `${daysLeft != null ? `, пробного осталось ${daysLeft} дн.` : ""} — ` +
    `написали ему с кнопкой оплаты.\n` +
    when()
  );
}

// Названия для лога тестовых отправок — те же формулировки, что в админке.
const TEST_LABELS = {
  trial_start: "Первый день пробного периода",
  trial_end: "Последний день пробного периода",
  trial_post: "После окончания пробного периода",
  paid_pre: "Перед окончанием платной подписки",
  paid_post: "После окончания платной подписки",
  payment_abandoned: "Не завершил оплату",
  breakfast: "Напоминание про завтрак",
  lunch: "Напоминание про обед",
  dinner: "Напоминание про ужин"
};

// «Проверить на себе» из админки: сообщение ушло только админу, людям — нет.
async function test(userId, kind) {
  const who = await notify().userLabel(userId);
  await channelLog.postFor(
    "notify_personal",
    userId,
    `🧪 <b>Проверка уведомления на себе</b>\n\n` +
    `${who} отправил себе пример: «${esc(TEST_LABELS[kind] || kind)}».\n` +
    `Пользователям это сообщение не уходило.\n` +
    when()
  );
}

// --- Мелкие уведомления (тренер ↔ клиент, подтверждения оплат) ---
// Отдельный тумблер `notify_small`: этих сообщений больше всего, и если станет шумно,
// их выключают, не теряя догонялку и апселл лимита.

// Тренеру — клиент добавил запись о питании. Уходит на КАЖДУЮ запись клиента,
// поэтому текст короткий: длинная карточка тут только мешала бы читать канал.
async function trainerClientScan(trainerId, clientId) {
  const [trainerWho, clientWho] = await Promise.all([
    notify().userLabel(trainerId),
    notify().userLabel(clientId)
  ]);
  await channelLog.postFor(
    "notify_small",
    trainerId,
    `📋 <b>Уведомили тренера о записи клиента</b>\n\n` +
    `Тренеру ${trainerWho}: клиент ${clientWho} добавил запись о питании.\n` +
    when()
  );
}

// Клиенту — тренер оставил комментарий к его записи.
async function trainerComment(clientId) {
  const who = await notify().userLabel(clientId);
  await channelLog.postFor(
    "notify_small",
    clientId,
    `💬 <b>Уведомили клиента о комментарии тренера</b>\n\n` +
    `Написали ${who}: тренер прокомментировал его запись.\n` +
    when()
  );
}

// Клиенту — его подключили к тренеру, PRO открыт. trainerId может не приехать
// (роут отдаёт объект пользователя) — тогда просто не называем тренера.
async function clientConnected(clientId, trainerId) {
  const clientWho = await notify().userLabel(clientId);
  const trainerWho = trainerId ? await notify().userLabel(trainerId) : null;
  await channelLog.postFor(
    "notify_small",
    clientId,
    `🤝 <b>Уведомили клиента о подключении к тренеру</b>\n\n` +
    `Написали ${clientWho}: он подключён к тренеру${trainerWho ? ` ${trainerWho}` : ""}, ` +
    `доступ к PRO открыт.\n` +
    when()
  );
}

// Тренеру — к нему подключился новый клиент.
async function trainerNewClient(trainerId, clientId) {
  const [trainerWho, clientWho] = await Promise.all([
    notify().userLabel(trainerId),
    notify().userLabel(clientId)
  ]);
  await channelLog.postFor(
    "notify_small",
    trainerId,
    `🙋 <b>Уведомили тренера о новом клиенте</b>\n\n` +
    `Написали тренеру ${trainerWho}: к нему подключился ${clientWho}.\n` +
    when()
  );
}

// Подтверждение оплаты самому покупателю. Сам факт оплаты пишется отдельно (тумблер
// `payments`) — здесь именно про то, что человек получил сообщение от бота.
async function purchaseConfirmed(userId, { tariff, renewal = false } = {}) {
  const who = await notify().userLabel(userId);
  await channelLog.postFor(
    "notify_small",
    userId,
    (renewal
      ? `🔁 <b>Отправили подтверждение продления</b>\n\n`
      : `✅ <b>Отправили подтверждение оплаты</b>\n\n`) +
    `Написали ${who}: подписка <b>${esc(tariff || "—")}</b> ` +
    `${renewal ? "продлена" : "оформлена"}, доступ открыт.\n` +
    when()
  );
}

module.exports = {
  mealRun,
  subscriptionRun,
  broadcastRun,
  abandonedCart,
  limitPush,
  test,
  trainerClientScan,
  trainerComment,
  clientConnected,
  trainerNewClient,
  purchaseConfirmed
};
