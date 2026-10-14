// Показатели кабинетов. Чистые функции без БД: на вход строки «блюдо за день»
// и посещаемость, на выход цифры для карточек, прогноз и рекомендации.
//
// Строка «блюдо за день» (dishDay):
//   { date, dish_id, name, category, image_url, portion_price, portion_grams,
//     planned,   - сколько порций заказано
//     trays,     - сколько подносов с этим блюдом увидела камера
//     eaten }    - съедено в порциях: Σ(1 - остаток) по подносам
// Посещаемость (attendanceDay): { date, present }

const { weekday, weekdayPhrase } = require("../utils/dates");

// Запас к прогнозу, чтобы хватило всем: лучше 3% лишнего, чем голодный ребёнок.
const FORECAST_SAFETY_MARGIN = 0.03;
// День недели считается «едят меньше», если там едят хуже среднего хотя бы на столько.
const WEEKDAY_DROP_THRESHOLD = 0.05;
// Блюдо «не едят», если его берёт не больше UNPOPULAR_TAKE детей
// или на подносе в среднем остаётся не меньше UNPOPULAR_LEFTOVER порции.
const UNPOPULAR_TAKE = 0.6;
const UNPOPULAR_LEFTOVER = 0.35;
const UNPOPULAR_MIN_DAYS = 2;
const UNPOPULAR_MAX_TIPS = 2;
const BASELINE_DAYS = 5;
const SAME_WEEKDAY_WINDOW = 4;

const CATEGORY_ORDER = ["soup", "main", "side", "salad", "drink", "bakery", "other"];

function round(n, digits = 0) {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function sum(rows, key) {
  return rows.reduce((a, r) => a + r[key], 0);
}

function byCategoryThenName(a, b) {
  const ca = CATEGORY_ORDER.indexOf(a.category);
  const cb = CATEGORY_ORDER.indexOf(b.category);
  return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb) || a.name.localeCompare(b.name, "ru");
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

// Доля съеденного на подносе, % (null, если камера блюдо не видела).
function eatenPct(row) {
  return row.trays > 0 ? round((row.eaten / row.trays) * 100) : null;
}

// Списания: сколько рублей из заказанного ушло в отходы.
// Отходы = заказано - съедено (невзятые порции + остатки на подносах).
function wasteSummary(rows) {
  let plannedRub = 0;
  let wasteRub = 0;
  for (const r of rows) {
    plannedRub += r.planned * r.portion_price;
    wasteRub += Math.max(0, r.planned - r.eaten) * r.portion_price;
  }
  return {
    plannedRub: round(plannedRub, 2),
    wasteRub: round(wasteRub, 2),
    wastePct: plannedRub > 0 ? round((wasteRub / plannedRub) * 100, 1) : 0
  };
}

// Исходный уровень списаний: первые BASELINE_DAYS дней с данными (до перехода на прогноз).
function baselineWastePct(rows) {
  const dates = new Set([...new Set(rows.map((r) => r.date))].sort().slice(0, BASELINE_DAYS));
  return wasteSummary(rows.filter((r) => dates.has(r.date))).wastePct;
}

// Экономия за день: сколько выбросили бы при старом уровне списаний минус сколько выбросили.
function savingsRub(baselinePct, day) {
  return round(((baselinePct - day.wastePct) / 100) * day.plannedRub);
}

function kidsSummary(present, students) {
  return { present, students, pct: students > 0 ? round((present / students) * 100) : 0 };
}

// Доля пришедших детей, взявших блюдо (по каждому дню-блюду). На ней строится прогноз заказа.
function takeRatios(history, presentByDate) {
  const out = [];
  for (const r of history) {
    const present = presentByDate.get(r.date);
    if (present > 0 && r.trays > 0) out.push({ ...r, ratio: r.trays / present });
  }
  return out;
}

// Доля порции, которую съедают (по каждому дню-блюду). На ней строятся советы про размер порции.
function eatShares(history) {
  return history.filter((r) => r.trays > 0).map((r) => ({ ...r, ratio: r.eaten / r.trays }));
}

function expectedPresent(targetDate, attendance, fallback) {
  const wd = weekday(targetDate);
  const sameWeekday = attendance
    .filter((a) => weekday(a.date) === wd && a.date < targetDate)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, SAME_WEEKDAY_WINDOW)
    .map((a) => a.present);
  return mean(sameWeekday) ?? mean(attendance.map((a) => a.present)) ?? fallback;
}

// Насколько в этот день недели показатель выше/ниже обычного (1 = как всегда).
function weekdayFactor(targetDate, ratios) {
  const overall = mean(ratios.map((r) => r.ratio));
  const wd = weekday(targetDate);
  const onDay = mean(ratios.filter((r) => weekday(r.date) === wd).map((r) => r.ratio));
  return overall && onDay ? onDay / overall : 1;
}

// Прогноз заказа на targetDate по меню этого дня: сколько детей возьмёт каждое блюдо.
// menu: [{ dish_id, name, category, image_url, portion_price, planned }], planned = «обычно».
function forecast({ targetDate, menu, history, attendance, students }) {
  const ratios = takeRatios(history, new Map(attendance.map((a) => [a.date, a.present])));
  const overallRate = mean(ratios.map((r) => r.ratio)) ?? 1;
  const factor = weekdayFactor(targetDate, ratios);
  const present = expectedPresent(targetDate, attendance, students);

  return menu
    .map((m) => {
      const rate =
        mean(ratios.filter((r) => r.dish_id === m.dish_id).map((r) => r.ratio)) ??
        mean(ratios.filter((r) => r.category === m.category).map((r) => r.ratio)) ??
        overallRate;
      const predicted = Math.ceil(present * rate * factor * (1 + FORECAST_SAFETY_MARGIN));
      return {
        dish_id: m.dish_id,
        name: m.name,
        category: m.category,
        image_url: m.image_url,
        usual: m.planned,
        forecast: predicted,
        diff: m.planned - predicted,
        diffRub: round((m.planned - predicted) * m.portion_price)
      };
    })
    .sort(byCategoryThenName);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Блюда, которые дети не берут или оставляют на подносе.
function unpopularDishes(history, presentByDate) {
  const out = [];
  for (const rows of groupBy(history.filter((r) => r.trays > 0), (r) => r.dish_id).values()) {
    if (rows.length < UNPOPULAR_MIN_DAYS) continue;
    const present = rows.reduce((a, r) => a + (presentByDate.get(r.date) || 0), 0);
    const takePct = present > 0 ? sum(rows, "trays") / present : 1;
    const leftover = 1 - sum(rows, "eaten") / sum(rows, "trays");
    if (takePct <= UNPOPULAR_TAKE || leftover >= UNPOPULAR_LEFTOVER) {
      out.push({ name: rows[0].name, takePct, leftover, score: (1 - takePct) + leftover });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, UNPOPULAR_MAX_TIPS);
}

function unpopularText(d) {
  if (d.takePct <= UNPOPULAR_TAKE) {
    return `«${d.name}» берут только ${round(d.takePct * 100)}% детей. Замените блюдо в меню.`;
  }
  return `«${d.name}»: на подносах остаётся ${round(d.leftover * 100)}%. Уменьшите порцию или замените блюдо.`;
}

// Рекомендации по правилам поверх статистики. Каждая - { type, text }.
function recommendations({ targetDate, history, attendance, forecastItems }) {
  const tips = [];
  const presentByDate = new Map(attendance.map((a) => [a.date, a.present]));
  const shares = eatShares(history);

  const factor = weekdayFactor(targetDate, shares);
  if (shares.length && factor < 1 - WEEKDAY_DROP_THRESHOLD) {
    tips.push({
      type: "weekday",
      text: `${capitalize(weekdayPhrase(targetDate))} дети едят меньше. Уменьшите порции на ${round((1 - factor) * 100)}%.`
    });
  }

  for (const d of unpopularDishes(history, presentByDate)) tips.push({ type: "dish", text: unpopularText(d) });

  const extra = forecastItems.filter((f) => f.diff > 0);
  if (extra.length) {
    const rub = round(sum(extra, "diffRub"));
    tips.push({
      type: "forecast",
      text: `По прогнозу можно заказать на ${sum(extra, "diff")} порций меньше и сэкономить около ${rub.toLocaleString("ru-RU")} ₽.`
    });
  }

  return tips;
}

// Дни школы без единого скана подноса (например, сегодня с утра) не дают данных о списаниях.
function onlyScannedDays(rows) {
  const scanned = new Set(rows.filter((r) => r.trays > 0).map((r) => `${r.school_id}|${r.date}`));
  return rows.filter((r) => scanned.has(`${r.school_id}|${r.date}`));
}

// Съедаемость набора строк: сколько съедено из взятых на подносы порций.
function listEatenPct(rows) {
  const trays = sum(rows, "trays");
  return trays > 0 ? round((sum(rows, "eaten") / trays) * 100) : null;
}

// Итог за период: списания, съедаемость, исходный уровень (первые дни периода) и экономия по дням.
function periodSummary(rows) {
  const baseDates = new Set([...new Set(rows.map((r) => r.date))].sort().slice(0, BASELINE_DAYS));
  const baseRows = rows.filter((r) => baseDates.has(r.date));
  const baselinePct = wasteSummary(baseRows).wastePct;
  const savings = [...groupBy(rows, (r) => r.date).values()]
    .reduce((total, list) => total + savingsRub(baselinePct, wasteSummary(list)), 0);
  return {
    ...wasteSummary(rows),
    eatenPct: listEatenPct(rows),
    baselinePct,
    baselineEatenPct: listEatenPct(baseRows),
    savingsRub: round(savings)
  };
}

// Сводка по блюдам за период, от самых нелюбимых к любимым.
function dishStats(rows) {
  return [...groupBy(rows, (r) => r.dish_id).values()]
    .map((list) => {
      const trays = sum(list, "trays");
      return {
        dish_id: list[0].dish_id,
        name: list[0].name,
        category: list[0].category,
        image_url: list[0].image_url,
        days: list.length,
        planned: sum(list, "planned"),
        eatenPct: trays > 0 ? round((sum(list, "eaten") / trays) * 100) : null,
        ...wasteSummary(list)
      };
    })
    .sort((a, b) => (a.eatenPct ?? 101) - (b.eatenPct ?? 101));
}

// Ряд по дням: списания и посещаемость.
function dailySeries(rows, attendance, students) {
  const presentByDate = new Map(attendance.map((a) => [a.date, a.present]));
  return [...groupBy(rows, (r) => r.date).entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => ({
      date,
      ...wasteSummary(list),
      eatenPct: listEatenPct(list),
      kids: kidsSummary(presentByDate.get(date) || 0, students)
    }));
}

module.exports = {
  FORECAST_SAFETY_MARGIN,
  round,
  eatenPct,
  wasteSummary,
  periodSummary,
  onlyScannedDays,
  baselineWastePct,
  savingsRub,
  kidsSummary,
  forecast,
  recommendations,
  dishStats,
  dailySeries,
  byCategoryThenName
};
