// Запросы к БД для показателей. Возвращают строки в формате services/metrics.js.

const db = require("../db");

// Блюда по дням: заказано + что увидела камера. schoolIds - массив id школ.
async function dishDays(schoolIds, from, to) {
  const { rows } = await db.query(
    `WITH t AS (
       SELECT ts.school_id, ts.scan_date, ti.dish_id,
              COUNT(*)::int AS trays,
              SUM(1 - ti.leftover_pct / 100.0)::float AS eaten
         FROM tray_scans ts
         JOIN tray_items ti ON ti.scan_id = ts.id
        WHERE ts.school_id = ANY($1) AND ts.scan_date BETWEEN $2 AND $3
        GROUP BY 1, 2, 3
     )
     SELECT m.school_id, m.date, m.dish_id, d.name, d.category, d.image_url,
            d.portion_grams, d.portion_price::float AS portion_price,
            d.supplier_id, m.planned_portions AS planned,
            COALESCE(t.trays, 0) AS trays, COALESCE(t.eaten, 0) AS eaten
       FROM menu_items m
       JOIN dishes d ON d.id = m.dish_id
       LEFT JOIN t ON t.school_id = m.school_id AND t.scan_date = m.date AND t.dish_id = m.dish_id
      WHERE m.school_id = ANY($1) AND m.date BETWEEN $2 AND $3
      ORDER BY m.date`,
    [schoolIds, from, to]
  );
  return rows;
}

// Сколько детей пришло по дням.
async function attendanceDays(schoolIds, from, to) {
  const { rows } = await db.query(
    `SELECT c.school_id, a.date, SUM(a.present_count)::int AS present
       FROM attendance a
       JOIN classes c ON c.id = a.class_id
      WHERE c.school_id = ANY($1) AND a.date BETWEEN $2 AND $3
      GROUP BY 1, 2
      ORDER BY 2`,
    [schoolIds, from, to]
  );
  return rows;
}

// Сколько детей числится в школе (сумма по классам).
async function studentsBySchool(schoolIds) {
  const { rows } = await db.query(
    `SELECT school_id, SUM(students_count)::int AS students
       FROM classes WHERE school_id = ANY($1) GROUP BY 1`,
    [schoolIds]
  );
  return new Map(rows.map((r) => [r.school_id, r.students]));
}

// Каталог блюд комбината с поставщиком.
async function listDishes(kombinatId) {
  const { rows } = await db.query(
    `SELECT d.id, d.name, d.category, d.image_url, d.portion_grams,
            d.portion_price::float AS portion_price, d.supplier_id, s.name AS supplier_name
       FROM dishes d
       LEFT JOIN suppliers s ON s.id = d.supplier_id
      WHERE d.kombinat_id = $1
      ORDER BY d.name`,
    [kombinatId]
  );
  return rows;
}

// Школы комбината с директорами (кабинет комбината и сводка в боте).
async function schoolsOf(kombinatId) {
  const { rows } = await db.query(
    `SELECT s.id, s.number, s.name, d.id AS director_id, d.full_name AS director_name
       FROM schools s
       LEFT JOIN directors d ON d.school_id = s.id
      WHERE s.kombinat_id = $1
      ORDER BY s.number`,
    [kombinatId]
  );
  return rows;
}

module.exports = { dishDays, attendanceDays, studentsBySchool, listDishes, schoolsOf };
