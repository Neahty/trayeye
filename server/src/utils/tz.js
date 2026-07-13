// Часовой пояс пользователя. Хранится как IANA-строка (например "Europe/Moscow").
// Дефолт — Москва. Простая валидация формата, чтобы безопасно подставлять в SQL.
const DEFAULT_TZ = "Europe/Moscow";

function userTz(user) {
  const tz = user && user.timezone;
  if (typeof tz === "string" && /^[A-Za-z]+\/[A-Za-z0-9_+\-/]+$/.test(tz)) {
    return tz;
  }
  return DEFAULT_TZ;
}

// Сегодняшняя календарная дата в поясе tz, строкой "YYYY-MM-DD".
function localToday(tz) {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz || DEFAULT_TZ });
}

// Шаг по дате-строке "YYYY-MM-DD" на delta дней, в UTC-пространстве (без tz-сдвигов).
function addDays(ymd, delta) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

module.exports = { userTz, DEFAULT_TZ, localToday, addDays };
