const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const { activityFactorFromWorkouts } = require("../utils/calories");
const { userTz, localToday, addDays } = require("../utils/tz");

const router = express.Router();

const PERIOD_DAYS = { day: 1, week: 7, month: 30, year: 365 };
// Гранулярность столбцов графика по периоду: день/неделя — по дням, месяц — по неделям, год — по месяцам.
const PERIOD_GRAN = { day: "day", week: "day", month: "week", year: "month" };

// Поддерживающий TDEE (без goal-дельты) — для «Баланс калорий».
function maintenanceTdee(u) {
  if (!u.gender || !u.age || !u.height || !u.weight) return null;
  let bmr = 10 * Number(u.weight) + 6.25 * Number(u.height) - 5 * Number(u.age);
  bmr += u.gender === "male" ? 5 : -161;
  const factor = activityFactorFromWorkouts(u.workouts_per_week, u.activity);
  return Math.round(bmr * factor);
}

// Считает полную статистику для произвольного пользователя (строка users).
// Вынесено в функцию, чтобы переиспользовать в кабинете тренера (статистика клиента)
// — расчёт идёт в часовом поясе ИМЕННО этого пользователя.
async function computeStats(user, periodRaw) {
  const period = PERIOD_DAYS[periodRaw] ? periodRaw : "week";
  const days = PERIOD_DAYS[period];
  const granularity = PERIOD_GRAN[period];
  const userId = user.id;
  const tz = userTz(user);

    // Суммы по бакетам графика (день/неделя/месяц — в часовом поясе пользователя)
    const daily = await db.query(
      `SELECT date_trunc($4, scanned_at AT TIME ZONE $3)::date AS day,
              SUM(calories)::int AS calories,
              SUM(protein) AS protein,
              SUM(fat) AS fat,
              SUM(carbs) AS carbs
       FROM scans
       WHERE user_id = $1 AND scanned_at >= NOW() - ($2 || ' days')::interval
       GROUP BY day ORDER BY day ASC`,
      [userId, days, tz, granularity]
    );

    const chart = daily.rows.map((r) => ({
      day: r.day,
      calories: r.calories || 0,
      protein: Math.round((Number(r.protein) || 0) * 10) / 10,
      fat: Math.round((Number(r.fat) || 0) * 10) / 10,
      carbs: Math.round((Number(r.carbs) || 0) * 10) / 10
    }));

    const totals = chart.reduce(
      (acc, d) => {
        acc.calories += d.calories;
        acc.protein += d.protein;
        acc.fat += d.fat;
        acc.carbs += d.carbs;
        return acc;
      },
      { calories: 0, protein: 0, fat: 0, carbs: 0 }
    );
    // Округляем суммы БЖУ до 0.1 г: иначе накопление дробных бакетов даёт хвосты вида
    // 0.30000000000000004, которые «грязнят» числа на странице статистики.
    totals.protein = Math.round(totals.protein * 10) / 10;
    totals.fat = Math.round(totals.fat * 10) / 10;
    totals.carbs = Math.round(totals.carbs * 10) / 10;
    // Число дней с записями в периоде — для реалистичных средних «на день»
    // (не зависит от гранулярности бакетов графика).
    const activeRows = await db.query(
      `SELECT COUNT(DISTINCT (scanned_at AT TIME ZONE $3)::date)::int AS active_days
       FROM scans
       WHERE user_id = $1 AND scanned_at >= NOW() - ($2 || ' days')::interval`,
      [userId, days, tz]
    );
    const activeDays = activeRows.rows[0]?.active_days || 0;
    const nDays = activeDays || 1;
    const averages = {
      calories: Math.round(totals.calories / nDays),
      protein: Math.round((totals.protein / nDays) * 10) / 10,
      fat: Math.round((totals.fat / nDays) * 10) / 10,
      carbs: Math.round((totals.carbs / nDays) * 10) / 10
    };

    // Дефицит/профицит относительно нормы
    const norm = user.daily_calories || 0;
    const balance = norm ? averages.calories - norm : null;

    // Streak: сколько дней подряд (включая сегодня назад) есть записи.
    // Дни — строкой в поясе пользователя, чтобы стрик совпадал с достижениями и не плыл у полуночи.
    const streakRows = await db.query(
      `SELECT DISTINCT to_char(scanned_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day FROM scans
       WHERE user_id = $1`,
      [userId, tz]
    );
    let streak = 0;
    const daySet = new Set(streakRows.rows.map((r) => r.day));
    let cursor = localToday(tz);
    // допускаем что сегодня может быть без записи — стартуем со вчера если нужно
    if (!daySet.has(cursor)) cursor = addDays(cursor, -1);
    while (daySet.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }

    // Топ частых блюд
    const topFrequent = await db.query(
      `SELECT dish_name, COUNT(*)::int AS count FROM scans
       WHERE user_id = $1 AND scanned_at >= NOW() - ($2 || ' days')::interval
       GROUP BY dish_name ORDER BY count DESC LIMIT 5`,
      [userId, days]
    );

    // Топ калорийных блюд
    const topCalorie = await db.query(
      `SELECT dish_name, calories FROM scans
       WHERE user_id = $1 AND scanned_at >= NOW() - ($2 || ' days')::interval
       ORDER BY calories DESC LIMIT 5`,
      [userId, days]
    );

    // История веса
    const weight = await db.query(
      `SELECT weight, recorded_at FROM weight_history
       WHERE user_id = $1 ORDER BY recorded_at ASC`,
      [userId]
    );

    // Разбивка по приёмам за период
    const mealRows = await db.query(
      `SELECT meal_type, SUM(calories)::int AS calories,
              SUM(protein) AS protein, SUM(fat) AS fat, SUM(carbs) AS carbs, COUNT(*)::int AS count
       FROM scans
       WHERE user_id = $1 AND scanned_at >= NOW() - ($2 || ' days')::interval
       GROUP BY meal_type`,
      [userId, days]
    );
    const meal_breakdown = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
    for (const r of mealRows.rows) {
      if (meal_breakdown[r.meal_type] != null) meal_breakdown[r.meal_type] = r.calories || 0;
    }

    // Кол-во фото-сканов, всего записей и ПРИЁМОВ за период.
    // Приём пищи = одно фото/текст (общий batch_id), а не отдельное блюдо: фото из 3 блюд — это
    // один приём, а не три. Старые строки без batch_id считаем по id.
    const countRows = await db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE source = 'photo')::int AS photos,
              COUNT(DISTINCT COALESCE(batch_id, id::text))::int AS meals
       FROM scans
       WHERE user_id = $1 AND scanned_at >= NOW() - ($2 || ' days')::interval`,
      [userId, days]
    );
    const totalMeals = countRows.rows[0]?.meals || 0;
    // Приёмов пищи в день — в среднем по ДНЯМ С ЗАПИСЯМИ (активным), а не по всем календарным:
    // иначе при редком логе за месяц выходило бессмысленное «0.1 приёмов в день».
    // Округляем до ЦЕЛОГО: «в среднем 3 приёма в день» понятнее, чем «2.9» (приёмы — штучные).
    const mealsPerDay = Math.round(totalMeals / nDays);

    // Баланс: поступление vs расход (TDEE поддержания × дни)
    const tdee = maintenanceTdee(user);
    const expenditure = tdee != null ? tdee * nDays : null;
    const balanceDeficit = expenditure != null ? expenditure - totals.calories : null;

    return {
      period,
      granularity,
      totals,
      averages,
      balance,
      streak,
      chart,
      meal_breakdown,
      photos_count: countRows.rows[0]?.photos || 0,
      meals_per_day: mealsPerDay,
      tdee,
      expenditure,
      balance_deficit: balanceDeficit,
      daily_norm: norm || null,
      goal_protein: user.daily_protein != null ? Number(user.daily_protein) : null,
      goal_fat: user.daily_fat != null ? Number(user.daily_fat) : null,
      goal_carbs: user.daily_carbs != null ? Number(user.daily_carbs) : null,
      top_frequent: topFrequent.rows,
      top_calorie: topCalorie.rows,
      weight_history: weight.rows
    };
}

// GET /api/stats?period=day|week|month|year
router.get("/", auth, async (req, res, next) => {
  try {
    res.json(await computeStats(req.user, req.query.period));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.computeStats = computeStats;
