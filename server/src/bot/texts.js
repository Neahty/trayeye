// Тексты бота. Чистые функции: на входе данные, на выходе строка - так их легко тестировать.

const { dayLabel } = require("../services/events");

const ROLE_LABEL = { director: "директор", kombinat: "комбинат питания", cook: "повар" };

const rub = (n) => `${Math.round(Number(n) || 0).toLocaleString("ru-RU")} ₽`;
const num = (n) => Math.round(Number(n) || 0).toLocaleString("ru-RU");

function siteUrl(path = "") {
  return `${(process.env.PUBLIC_URL || "").replace(/\/+$/, "")}${path}`;
}

function welcome() {
  return [
    "👋 Это бот TrayEye: остатки еды в школьной столовой.",
    "",
    "Чтобы начать, привяжите школу:",
    "1. На компьютере откройте кабинет TrayEye → меню профиля → «Привязать Telegram».",
    "2. Отсканируйте QR-код телефоном или пришлите сюда код из 6 символов."
  ].join("\n");
}

function askCode() {
  return "Пришлите код из кабинета - 6 символов, например K7M-2QX. Код действует 15 минут.";
}

function wrongCode() {
  return "Код не подошёл: он неверный, истёк (живёт 15 минут) или уже использован. Возьмите новый в кабинете.";
}

function place(chat) {
  return chat.school_name || chat.kombinat_name;
}

function roleHelp(chat) {
  if (chat.role === "cook") {
    return [
      "📷 Присылайте фото подносов после еды - сверху, чтобы все тарелки попали в кадр.",
      "Пустые подносы я засчитываю сам, подносы с остатками отправляю в нейросеть пачкой."
    ].join("\n");
  }
  return [
    "📊 «Сегодня» - сводка за день: списания, экономия, сколько детей поело, прогноз.",
    "🔔 Сюда же приходят уведомления из кабинета.",
    chat.role === "director" ? "📷 Фото подноса тоже можно прислать - посчитаю остатки." : null
  ].filter(Boolean).join("\n");
}

function linked(chat) {
  return `✅ Готово! Вы подключены как ${ROLE_LABEL[chat.role]}: ${place(chat)}.\n\n${roleHelp(chat)}`;
}

function home(chat) {
  return `Вы подключены как ${ROLE_LABEL[chat.role]}: ${place(chat)}.\n\n${roleHelp(chat)}`;
}

function wastePart(waste) {
  if (waste.pct === null || waste.pct === undefined) return "Списания: камера сегодня ещё не снимала";
  return `Списания: ${waste.pct}% (было ${waste.baselinePct}%)`;
}

// overview - services/overview.schoolOverview.
function directorSummary(chat, overview) {
  const { cards, forecast, recommendations } = overview;
  const lines = [
    `📊 ${chat.school_name}, ${dayLabel(overview.date)}`,
    wastePart(cards.waste),
    `Экономия: ${rub(cards.savings.rub)}`,
    `Детей: ${num(cards.kids.present)} из ${num(cards.kids.students)} (${cards.kids.pct}%)`
  ];
  if (forecast?.items?.length) {
    lines.push("", `Прогноз на ${dayLabel(forecast.date)}:`);
    for (const f of forecast.items.slice(0, 5)) {
      lines.push(`• ${f.name} - ${num(f.forecast)} порций (обычно ${num(f.usual)})`);
    }
  }
  if (recommendations?.length) lines.push("", `💡 ${recommendations[0].text}`);
  lines.push("", siteUrl("/director"));
  return lines.join("\n");
}

// overview - services/overview.kombinatOverview.
function kombinatSummary(chat, date, overview) {
  const t = overview.totals;
  const lines = [
    `📊 ${chat.kombinat_name}, ${dayLabel(date)}`,
    `Школ: ${t.schools}`,
    t.wastePct === null ? "Списания: камеры сегодня ещё не снимали" : `Списания: ${t.wastePct}% (было ${t.baselinePct}%)`,
    `Экономия: ${rub(t.savingsRub)}`,
    `Детей: ${num(t.kids.present)} из ${num(t.kids.students)} (${t.kids.pct}%)`
  ];
  const worst = overview.schools
    .filter((s) => s.cards.waste.pct !== null && s.cards.waste.pct !== undefined)
    .sort((a, b) => b.cards.waste.pct - a.cards.waste.pct)
    .slice(0, 3);
  if (worst.length) {
    lines.push("", "Больше всего списаний:");
    for (const s of worst) lines.push(`• ${s.name} - ${s.cards.waste.pct}%`);
  }
  lines.push("", siteUrl("/kombinat"));
  return lines.join("\n");
}

function itemsLine(items) {
  return items.map((it) => `${it.name} ${it.leftover_pct}%`).join(", ");
}

// Итог по одному фото из camera.recordTrays: на фото бывает несколько подносов.
// menu - блюда дня: если еды из меню на фото нет, подсказываем, что в меню сейчас.
function trayResult(result, menu = []) {
  if (result.error) return "⚠️ Нейросеть сейчас не ответила, фото не засчитано. Пришлите его ещё раз чуть позже.";
  if (result.no_menu_dishes) {
    const names = menu.map((m) => m.name).join(", ");
    return `🤔 На фото не нашёл блюд из сегодняшнего меню${names ? ` (${names})` : ""}. Проверьте меню школы на сайте.`;
  }
  const trays = result.trays || [];
  if (result.is_empty) {
    return trays.length > 1
      ? `✅ Пустых подносов: ${trays.length}. Всё съедено, засчитал без нейросети.`
      : "✅ Поднос пустой - всё съедено. Засчитал без нейросети.";
  }
  if (trays.length === 1) {
    return ["🍽 Осталось от порции:", ...trays[0].items.map((it) => `• ${it.name}: ${it.leftover_pct}%`)].join("\n");
  }
  return [
    `🍽 Подносов на фото: ${trays.length}. Осталось от порции:`,
    ...trays.map((t, i) => `${i + 1}. ${itemsLine(t.items)}`)
  ].join("\n");
}

function notification(event) {
  return `🔔 ${event.text}\n${siteUrl(event.link)}`;
}

module.exports = {
  ROLE_LABEL, welcome, askCode, wrongCode, linked, home, roleHelp,
  directorSummary, kombinatSummary, trayResult, notification, siteUrl
};
