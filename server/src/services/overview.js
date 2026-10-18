// Сводка по школе на день: карточки, прогноз на следующий учебный день и рекомендации.
// Одна и та же сводка нужна директору (своя школа) и комбинату (все его школы).

const metrics = require("./metrics");
const data = require("./schoolData");
const { addDays, nextSchoolDay } = require("../utils/dates");

const HISTORY_DAYS = 120;

function forSchool(schoolId, rows) {
  return rows.filter((r) => r.school_id === schoolId);
}

// Сводки по нескольким школам за один проход по БД. Возвращает Map(schoolId -> сводка).
async function schoolOverviews(schoolIds, date) {
  const target = nextSchoolDay(date);
  const from = addDays(date, -HISTORY_DAYS);
  const [allRows, allAttendance, students, rules] = await Promise.all([
    data.dishDays(schoolIds, from, target),
    data.attendanceDays(schoolIds, from, date),
    data.studentsBySchool(schoolIds),
    data.forecastRules(schoolIds)
  ]);

  const result = new Map();
  for (const id of schoolIds) {
    const rows = forSchool(id, allRows);
    const attendance = forSchool(id, allAttendance);
    // Всё, что уже случилось (включая сегодня), - основа прогноза и рекомендаций.
    const past = rows.filter((r) => r.date <= date);
    const todayRows = rows.filter((r) => r.date === date);
    const studentsCount = students.get(id) || 0;

    // Пока камера за день ничего не сняла, считать нечего: иначе весь заказ выглядит списанным.
    const scanned = todayRows.some((r) => r.trays > 0);
    const day = metrics.wasteSummary(scanned ? todayRows : []);
    const baselinePct = metrics.baselineWastePct(past);
    const present = attendance.find((a) => a.date === date)?.present || 0;

    const forecastItems = metrics.forecast({
      targetDate: target,
      menu: rows.filter((r) => r.date === target),
      history: past,
      attendance,
      students: studentsCount,
      margin: rules.margin
    });

    result.set(id, {
      date,
      cards: {
        waste: { pct: scanned ? day.wastePct : null, baselinePct, rub: day.wasteRub, plannedRub: day.plannedRub },
        savings: {
          rub: scanned ? metrics.savingsRub(baselinePct, day) : 0,
          monthRub: metrics.savingsAfter(past, baselinePct, addDays(date, -metrics.ECONOMICS_DAYS))
        },
        kids: metrics.kidsSummary(present, studentsCount)
      },
      forecast: { date: target, items: forecastItems },
      recommendations: metrics.recommendations({
        targetDate: target,
        history: past,
        attendance,
        forecastItems,
        unpopularTake: rules.unpopularTake
      })
    });
  }
  return result;
}

async function schoolOverview(schoolId, date) {
  return (await schoolOverviews([schoolId], date)).get(schoolId);
}

// Статистика одной школы за период: итоги, ряд по дням, блюда.
// Нужна директору (своя школа) и комбинату (карточка школы).
async function schoolStats(schoolId, { from, to }) {
  const [allRows, attendance, students] = await Promise.all([
    data.dishDays([schoolId], from, to),
    data.attendanceDays([schoolId], from, to),
    data.studentsBySchool([schoolId])
  ]);
  const rows = metrics.onlyScannedDays(allRows);
  return {
    from,
    to,
    summary: metrics.periodSummary(rows),
    series: metrics.dailySeries(rows, attendance, students.get(schoolId) || 0),
    dishes: metrics.dishStats(rows)
  };
}

// Итоги комбината за день по его школам (schools - из schoolData.schoolsOf):
// главная кабинета комбината и сводка «Сегодня» в боте.
async function kombinatOverview(schools, date) {
  const overviews = schools.length ? await schoolOverviews(schools.map((s) => s.id), date) : new Map();
  const list = schools.map((s) => ({ ...s, ...overviews.get(s.id) }));

  const present = list.reduce((a, s) => a + s.cards.kids.present, 0);
  const students = list.reduce((a, s) => a + s.cards.kids.students, 0);
  const plannedRub = list.reduce((a, s) => a + s.cards.waste.plannedRub, 0);
  const wasteRub = list.reduce((a, s) => a + s.cards.waste.rub, 0);
  // «Было»: исходный уровень школ, взвешенный по сумме заказа (до первых сканов - простое среднее).
  const baselinePct = plannedRub > 0
    ? list.reduce((a, s) => a + s.cards.waste.baselinePct * s.cards.waste.plannedRub, 0) / plannedRub
    : list.reduce((a, s) => a + s.cards.waste.baselinePct, 0) / (list.length || 1);
  return {
    totals: {
      savingsRub: list.reduce((a, s) => a + s.cards.savings.rub, 0),
      wasteRub: metrics.round(wasteRub, 2),
      wastePct: plannedRub > 0 ? metrics.round((wasteRub / plannedRub) * 100, 1) : null,
      baselinePct: metrics.round(baselinePct, 1),
      kids: metrics.kidsSummary(present, students),
      schools: list.length,
      economics: metrics.subscriptionEconomics({
        savingsRub: list.reduce((a, s) => a + s.cards.savings.monthRub, 0),
        schools: list.length
      })
    },
    schools: list
  };
}

module.exports = { schoolOverview, schoolOverviews, schoolStats, kombinatOverview };
