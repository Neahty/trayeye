// Учебные даты. Всё считаем строками YYYY-MM-DD в поясе школы (APP_TZ),
// чтобы «сегодня» на сервере совпадало с «сегодня» в столовой.

const DEFAULT_TZ = "Europe/Moscow";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Винительный падеж для фраз «в среду дети едят меньше». Индекс = день недели (1 = пн).
const WEEKDAY_IN = [null, "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу", "в воскресенье"];

function appTz() {
  return process.env.APP_TZ || DEFAULT_TZ;
}

// APP_TODAY фиксирует «сегодня» для демо и тестов.
function today() {
  if (process.env.APP_TODAY) return process.env.APP_TODAY;
  return new Intl.DateTimeFormat("en-CA", { timeZone: appTz() }).format(new Date());
}

function toUtc(iso) {
  return Date.parse(`${iso}T00:00:00Z`);
}

function addDays(iso, n) {
  return new Date(toUtc(iso) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

// 1 = понедельник ... 7 = воскресенье.
function weekday(iso) {
  const d = new Date(toUtc(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}

function isSchoolDay(iso) {
  return weekday(iso) <= 5;
}

function nextSchoolDay(iso) {
  let d = addDays(iso, 1);
  while (!isSchoolDay(d)) d = addDays(d, 1);
  return d;
}

// count последних учебных дней строго ДО iso, по возрастанию.
function previousSchoolDays(iso, count) {
  const days = [];
  let d = iso;
  while (days.length < count) {
    d = addDays(d, -1);
    if (isSchoolDay(d)) days.unshift(d);
  }
  return days;
}

function weekdayPhrase(iso) {
  return WEEKDAY_IN[weekday(iso)];
}

module.exports = {
  today, addDays, weekday, isSchoolDay, nextSchoolDay, previousSchoolDays, weekdayPhrase
};
