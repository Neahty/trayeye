// Хелперы для роутов.

// Безопасный разбор числового id из параметров пути.
// Возвращает положительное целое или null (тогда роут отдаёт 400 bad_id вместо запроса с NaN,
// который ронял Postgres в 500).
function parseId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = { parseId };
