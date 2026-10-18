// Форматирование чисел и дат для интерфейса.

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export function rub(n) {
  return `${Math.round(n || 0).toLocaleString("ru-RU")} ₽`;
}

export function pct(n) {
  return n === null || n === undefined ? "-" : `${n}%`;
}

// Индекс несъедаемости (несъеденное / приготовленное) по методике Роспотребнадзора:
// до 10% - норма, 10-30% - риск, больше 30% - высокий риск. Наши «списания» считаются так же.
export const WASTE_ZONES_HINT = "Индекс несъедаемости по методике Роспотребнадзора: до 10% - норма, 10-30% - риск, больше 30% - высокий риск.";

export function wasteZone(value) {
  if (value === null || value === undefined) return null;
  if (value < 10) return { key: "norm", label: "норма" };
  if (value <= 30) return { key: "risk", label: "риск" };
  return { key: "high", label: "высокий риск" };
}

function parseIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// «12 октября, среда»
export function dayLong(iso) {
  const d = parseIso(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${WEEKDAYS[d.getUTCDay()]}`;
}

// «12.10»
export function dayShort(iso) {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
}

export function dateTime(value) {
  return value ? new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "-";
}

// Приветствие по имени и отчеству из ФИО «Фамилия Имя Отчество».
export function greetingName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  return parts.length >= 3 ? `${parts[1]} ${parts[2]}` : parts.join(" ");
}

export function greeting(hour = new Date().getHours()) {
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

export const CATEGORY_LABELS = {
  soup: "Первое",
  main: "Второе",
  side: "Гарнир",
  salad: "Салат",
  drink: "Напиток",
  bakery: "Выпечка",
  other: "Другое"
};

// Дата YYYY-MM-DD по часам браузера со сдвигом в днях (для полей ввода дат).
export function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA");
}
