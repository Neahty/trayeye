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
  const [allRows, allAttendance, students] = await Promise.all([
    data.dishDays(schoolIds, from, target),
    data.attendanceDays(schoolIds, from, date),
    data.studentsBySchool(schoolIds)
  ]);

  const result = new Map();
  for (const id of schoolIds) {
    const rows = forSchool(id, allRows);
    const attendance = forSchool(id, allAttendance);
    // Всё, что уже случилось (включая сегодня), - основа прогноза и рекомендаций.
    const past = rows.filter((r) => r.date <= date);
    const todayRows = rows.filter((r) => r.date === date);
    const studentsCount = students.get(id) || 0;

    const day = metrics.wasteSummary(todayRows);
    const baselinePct = metrics.baselineWastePct(past);
    const present = attendance.find((a) => a.date === date)?.present || 0;

    const forecastItems = metrics.forecast({
      targetDate: target,
      menu: rows.filter((r) => r.date === target),
      history: past,
      attendance,
      students: studentsCount
    });

    result.set(id, {
      date,
      cards: {
        waste: { pct: day.wastePct, baselinePct, rub: day.wasteRub },
        savings: { rub: todayRows.length ? metrics.savingsRub(baselinePct, day) : 0 },
        kids: metrics.kidsSummary(present, studentsCount)
      },
      forecast: { date: target, items: forecastItems },
      recommendations: metrics.recommendations({
        targetDate: target,
        history: past,
        attendance,
        forecastItems
      })
    });
  }
  return result;
}

async function schoolOverview(schoolId, date) {
  return (await schoolOverviews([schoolId], date)).get(schoolId);
}

module.exports = { schoolOverview, schoolOverviews };
