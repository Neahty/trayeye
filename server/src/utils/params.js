// Разбор ?date= и ?from=&to= для роутов кабинетов.
// При ошибке сами отвечают 400 и возвращают null - роуту остаётся только выйти.

const { today, addDays } = require("./dates");
const { parseDate, badRequest } = require("./http");

const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 366;

function dateParam(req, res) {
  if (req.query.date === undefined) return today();
  const d = parseDate(req.query.date);
  if (!d) badRequest(res, "bad_date");
  return d;
}

function periodParams(req, res) {
  const to = req.query.to === undefined ? today() : parseDate(req.query.to);
  const from = req.query.from === undefined && to ? addDays(to, -DEFAULT_PERIOD_DAYS) : parseDate(req.query.from);
  if (!from || !to || from > to || addDays(from, MAX_PERIOD_DAYS) < to) {
    badRequest(res, "bad_period");
    return null;
  }
  return { from, to };
}

module.exports = { dateParam, periodParams };
