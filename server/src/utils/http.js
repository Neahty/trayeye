// Хелперы разбора входных данных для роутов.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Положительное целое или null (роут отвечает 400, а не роняет Postgres на NaN).
function parseId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Целое в диапазоне [min, max] или null. null, "", true и [5] - не числа (Number() дал бы 0/1/5).
function parseIntInRange(v, min, max) {
  if (typeof v !== "number" && (typeof v !== "string" || v.trim() === "")) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

// Дата YYYY-MM-DD, которая реально существует в календаре, или null.
function parseDate(v) {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

// Непустая строка после trim, не длиннее max, или null.
function parseText(v, max) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= max ? s : null;
}

function badRequest(res, error) {
  return res.status(400).json({ error });
}

module.exports = { parseId, parseIntInRange, parseDate, parseText, badRequest };
