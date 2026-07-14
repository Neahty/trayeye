// Вычисление достижений из реальных данных пользователя и фиксация разблокировок.
const db = require("../db");
const { userTz, localToday, addDays } = require("../utils/tz");

const DESSERT_KEYWORDS = ["десерт", "торт", "пирожн", "мороженое", "шоколад", "конфет", "пончик", "чизкейк", "маффин", "печенье", "вафл"];
const FASTFOOD_KEYWORDS = ["фастфуд", "бургер", "пицц", "картоф", "фри", "наггетс", "хот-дог", "хотдог", "шаурма", "шаверма", "кола", "чипсы", "донер"];

const NORM_TOLERANCE = 0.15;

// Все «дни» считаем в поясе пользователя (как History/Stats), а не в UTC, иначе
// ночные/утренние записи попадают в чужой день и стрик расходится со статистикой.
async function computeStreak(userId, tz) {
  const { rows } = await db.query(
    `SELECT DISTINCT to_char(scanned_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day
       FROM scans WHERE user_id = $1`,
    [userId, tz]
  );
  const set = new Set(rows.map((r) => r.day));
  let streak = 0;
  let cursor = localToday(tz);
  if (!set.has(cursor)) cursor = addDays(cursor, -1);
  while (set.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

async function gatherMetrics(userId, user, tz) {
  const u = user || {};
  tz = tz || userTz(u);
  const m = {
    total_scans: 0,
    manual_scans: 0,
    profile_filled: !!(u.gender && u.age && u.height && u.weight),
    goal_set: !!u.goal,
    streak: 0,
    has_weight: false,
    weight_loss_kg: 0,
    goal_weight_reached: false,
    days_in_norm: 0,
    first_payment: false,
    payments_count: 0,
    pro_days: 0,
    dessert_added: false,
    clean_day: false,
    ideal_macros_day: false,
    day_over_norm: false,
    missed_one_day: false,
    returned_after_break: false,
    full_week_logged: false
  };

  // Счётчики сканов
  const counts = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE source IN ('manual','text'))::int AS manual
     FROM scans WHERE user_id = $1`,
    [userId]
  );
  m.total_scans = counts.rows[0].total;
  m.manual_scans = counts.rows[0].manual;

  m.streak = await computeStreak(userId, tz);

  // Дневные агрегаты (день — в поясе пользователя, строкой YYYY-MM-DD)
  const daily = await db.query(
    `SELECT to_char(scanned_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day, SUM(calories)::int AS cal,
            SUM(protein) AS p, SUM(fat) AS f, SUM(carbs) AS c, COUNT(*)::int AS n
     FROM scans WHERE user_id = $1 GROUP BY day ORDER BY day ASC`,
    [userId, tz]
  );
  const days = daily.rows;
  const daySet = new Set(days.map((d) => d.day));

  const norm = Number(u.daily_calories) || 0;
  const nP = Number(u.daily_protein) || 0, nF = Number(u.daily_fat) || 0, nC = Number(u.daily_carbs) || 0;
  if (norm > 0) {
    for (const d of days) {
      if (Math.abs(d.cal - norm) <= norm * NORM_TOLERANCE) m.days_in_norm++;
      if (d.cal > norm) m.day_over_norm = true;
    }
  }
  if (nP > 0 && nF > 0 && nC > 0) {
    for (const d of days) {
      const okP = Math.abs(Number(d.p) - nP) <= nP * NORM_TOLERANCE;
      const okF = Math.abs(Number(d.f) - nF) <= nF * NORM_TOLERANCE;
      const okC = Math.abs(Number(d.c) - nC) <= nC * NORM_TOLERANCE;
      if (okP && okF && okC) { m.ideal_macros_day = true; break; }
    }
  }

  // Пропуски/возвраты
  const dayList = days.map((d) => d.day);
  for (let i = 1; i < dayList.length; i++) {
    const prev = Date.parse(dayList[i - 1] + "T00:00:00Z");
    const cur = Date.parse(dayList[i] + "T00:00:00Z");
    const gap = Math.round((cur - prev) / 86400000);
    if (gap === 2) m.missed_one_day = true;   // ровно один пропущенный день
    if (gap >= 2) m.returned_after_break = true; // вернулся после перерыва
  }

  // Полная неделя (последние 7 дней в поясе пользователя)
  const today = localToday(tz);
  let full = true;
  for (let i = 0; i < 7; i++) {
    if (!daySet.has(addDays(today, -i))) { full = false; break; }
  }
  m.full_week_logged = full && days.length >= 7;

  // Десерт / чистый день (по ключевым словам, реальные данные)
  const dessert = await db.query(
    `SELECT 1 FROM scans WHERE user_id = $1 AND (${DESSERT_KEYWORDS.map((_, i) => `dish_name ILIKE $${i + 2}`).join(" OR ")}) LIMIT 1`,
    [userId, ...DESSERT_KEYWORDS.map((k) => `%${k}%`)]
  );
  m.dessert_added = dessert.rows.length > 0;

  const dirty = await db.query(
    `SELECT DISTINCT to_char(scanned_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day FROM scans
     WHERE user_id = $1 AND (${FASTFOOD_KEYWORDS.map((_, i) => `dish_name ILIKE $${i + 3}`).join(" OR ")})`,
    [userId, tz, ...FASTFOOD_KEYWORDS.map((k) => `%${k}%`)]
  );
  const dirtySet = new Set(dirty.rows.map((r) => r.day));
  m.clean_day = days.some((d) => d.n >= 2 && !dirtySet.has(d.day));

  // Вес
  const weight = await db.query(
    `SELECT weight, recorded_at FROM weight_history WHERE user_id = $1 ORDER BY recorded_at ASC`,
    [userId]
  );
  const wRows = weight.rows;
  m.has_weight = wRows.length > 0 || u.weight != null;
  if (wRows.length >= 2) {
    const maxW = Math.max(...wRows.map((r) => Number(r.weight)));
    const lastW = Number(wRows[wRows.length - 1].weight);
    m.weight_loss_kg = Math.max(0, maxW - lastW);
  }
  const lastWeight = wRows.length ? Number(wRows[wRows.length - 1].weight) : Number(u.weight) || null;
  const target = Number(u.target_weight) || null;
  if (target && lastWeight) {
    if (u.goal === "loss") m.goal_weight_reached = lastWeight <= target;
    else if (u.goal === "gain") m.goal_weight_reached = lastWeight >= target;
    else m.goal_weight_reached = Math.abs(lastWeight - target) <= 1;
  }

  // Подписки / платежи
  const pay = await db.query(
    "SELECT COUNT(*)::int AS c FROM payments WHERE user_id = $1 AND status = 'succeeded'",
    [userId]
  );
  m.payments_count = pay.rows[0].c;
  m.first_payment = m.payments_count > 0;

  const sub = await db.query(
    "SELECT MIN(started_at) AS first FROM subscriptions WHERE user_id = $1",
    [userId]
  );
  if (sub.rows[0].first) {
    m.pro_days = Math.floor((Date.now() - new Date(sub.rows[0].first).getTime()) / 86400000);
  }

  return m;
}

function isUnlocked(criteria, m, unlockedCount) {
  const v = criteria.value;
  switch (criteria.type) {
    case "total_scans": return m.total_scans >= v;
    case "manual_scans": return m.manual_scans >= v;
    case "profile_filled": return m.profile_filled;
    case "goal_set": return m.goal_set;
    case "streak": return m.streak >= v;
    case "has_weight": return m.has_weight;
    case "weight_loss_kg": return m.weight_loss_kg >= v;
    case "goal_weight_reached": return m.goal_weight_reached;
    case "days_in_norm": return m.days_in_norm >= v;
    case "first_payment": return m.first_payment;
    case "payments_count": return m.payments_count >= v;
    case "pro_days": return m.pro_days >= v;
    case "dessert_added": return m.dessert_added;
    case "clean_day": return m.clean_day;
    case "ideal_macros_day": return m.ideal_macros_day;
    case "day_over_norm": return m.day_over_norm;
    case "missed_one_day": return m.missed_one_day;
    case "returned_after_break": return m.returned_after_break;
    case "full_week_logged": return m.full_week_logged;
    case "achievements_count": return unlockedCount >= v;
    default: return false;
  }
}

// Текущий прогресс по критерию (для прогресс-бара квестов). Возвращает { current, goal }.
// Числовые критерии → фактическое значение метрики против criteria.value.
// Булевы критерии (без value) → 0/1 против цели 1.
function metricValue(criteria, m) {
  const goal = criteria.value != null ? Number(criteria.value) : 1;
  const numeric = {
    total_scans: m.total_scans,
    manual_scans: m.manual_scans,
    streak: m.streak,
    weight_loss_kg: m.weight_loss_kg,
    days_in_norm: m.days_in_norm,
    payments_count: m.payments_count,
    pro_days: m.pro_days
  };
  if (criteria.type in numeric) {
    return { current: Number(numeric[criteria.type]) || 0, goal };
  }
  // Остальные — булевы: выполнено ⇒ current = goal, иначе 0.
  const done = isUnlocked(criteria, m, 0);
  return { current: done ? goal : 0, goal };
}

async function getForUser(userId, user) {
  const { rows: catalog } = await db.query("SELECT * FROM achievements ORDER BY sort ASC");
  const { rows: unlockedRows } = await db.query(
    "SELECT achievement_code, unlocked_at FROM user_achievements WHERE user_id = $1",
    [userId]
  );
  const unlockedMap = new Map(unlockedRows.map((r) => [r.achievement_code, r.unlocked_at]));
  const metrics = await gatherMetrics(userId, user, userTz(user));

  let baseCount = 0;
  const interim = catalog.map((a) => {
    const already = unlockedMap.has(a.code);
    const done = already || (a.criteria.type !== "achievements_count" && isUnlocked(a.criteria, metrics, 0));
    if (done && a.criteria.type !== "achievements_count") baseCount++;
    return { a, done, already };
  });

  const result = [];
  for (const { a, done, already } of interim) {
    let finalDone = done;
    if (a.criteria.type === "achievements_count") finalDone = already || baseCount >= a.criteria.value;
    if (finalDone && !already) {
      await db.query(
        `INSERT INTO user_achievements (user_id, achievement_code) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [userId, a.code]
      );
    }
    result.push({
      code: a.code,
      title: a.title,
      subtitle: a.subtitle,
      description: a.description,
      emoji: a.emoji,
      icon: a.icon,
      color: a.color,
      category: a.category,
      done: finalDone,
      unlocked_at: unlockedMap.get(a.code) || (finalDone ? new Date().toISOString() : null)
    });
  }
  const unlockedTotal = result.filter((r) => r.done).length;
  return { achievements: result, metrics, unlocked: unlockedTotal, total: result.length };
}

module.exports = { getForUser, computeStreak, gatherMetrics, isUnlocked, metricValue };
