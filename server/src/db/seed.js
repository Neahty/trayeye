// Демо-данные: комбинат, школы, классы, каталог блюд и история за 6 недель.
// Первые 2 недели - «до системы» (заказ по списку учеников), дальше - заказ по прогнозу.
// Генератор детерминированный: одинаковые цифры при каждом запуске на ту же дату.
// topUpDemo дописывает новые учебные дни, чтобы демо не устаревало между пересозданиями.

const { KOMBINAT, SUPPLIERS, SCHOOLS, DISHES, NEXT_DAY_MENU, WEEKDAY_APPETITE } = require("./demoData");
const { createLink } = require("../services/links");
const { dayLabel } = require("../services/events");
const { addDays, isSchoolDay, nextSchoolDay, previousSchoolDays, weekday } = require("../utils/dates");

const HISTORY_SCHOOL_DAYS = 30;
const BASELINE_SCHOOL_DAYS = 10;
const CLASS_SIZE = 28;
const LETTERS = ["А", "Б", "В", "Г"];
const GRADES = 11;
const BASE_ATTENDANCE = 0.94;
const ORDER_MARGIN = 0.03;
// «До системы» комбинат заказывает на 90% списочного состава.
const BASELINE_ORDER_SHARE = 0.9;
const RANDOM_SEED = 33;
// Блюдо, добавленное в каталог вручную (его нет в demoData): средний аппетит.
const DEFAULT_TAKE = 0.85;
const DEFAULT_EAT = 0.85;
// Дольше этого topUpDemo не догоняет: после долгого простоя демо проще пересоздать.
const MAX_TOP_UP_SCHOOL_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// mulberry32: маленький детерминированный ГПСЧ.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dayNumber = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / MS_PER_DAY);

// Классы 1А..11Г так, чтобы сумма учеников совпала с students.
function buildClasses(students) {
  const count = Math.max(1, Math.round(students / CLASS_SIZE));
  const perGrade = Math.ceil(count / GRADES);
  const names = [];
  for (let g = 1; g <= GRADES && names.length < count; g++) {
    for (let l = 0; l < perGrade && names.length < count; l++) names.push(`${g}${LETTERS[l]}`);
  }
  const base = Math.floor(students / names.length);
  const extra = students - base * names.length;
  return names.map((name, i) => ({ name, students: base + (i < extra ? 1 : 0) }));
}

// Меню дня по двухнедельному циклу: суп, второе, гарнир, салат, напиток.
function menuForDay(index, byCategory) {
  const pick = (cat, shift) => byCategory[cat][(index + shift) % byCategory[cat].length];
  return [pick("soup", 0), pick("main", 1), pick("side", 2), pick("salad", 0), pick("drink", 1)];
}

async function resetAll(client) {
  await client.query(
    `TRUNCATE events, tray_items, tray_scans, attendance, menu_items, classes, dishes,
              access_links, directors, schools, suppliers, kombinats RESTART IDENTITY CASCADE`
  );
}

async function insertCatalog(client) {
  const k = await client.query("INSERT INTO kombinats (name) VALUES ($1) RETURNING id", [KOMBINAT]);
  const kombinatId = k.rows[0].id;
  const supplierIds = [];
  for (const name of SUPPLIERS) {
    const r = await client.query("INSERT INTO suppliers (kombinat_id, name) VALUES ($1, $2) RETURNING id", [kombinatId, name]);
    supplierIds.push(r.rows[0].id);
  }
  const dishes = [];
  for (const d of DISHES) {
    const r = await client.query(
      `INSERT INTO dishes (kombinat_id, supplier_id, name, category, image_url, portion_grams, portion_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [kombinatId, supplierIds[d.supplier], d.name, d.category, `/dishes/${d.slug}.jpg`, d.grams, d.price]
    );
    dishes.push({ ...d, id: r.rows[0].id });
  }
  return { kombinatId, dishes };
}

// Каталог комбината из базы с аппетитом из demoData (по названию блюда).
async function loadCatalog(client, kombinatId) {
  const { rows } = await client.query("SELECT id, name, category FROM dishes WHERE kombinat_id = $1 AND archived_at IS NULL ORDER BY id", [kombinatId]);
  const demo = new Map(DISHES.map((d) => [d.name, d]));
  return rows.map((r) => ({ take: DEFAULT_TAKE, eat: DEFAULT_EAT, ...demo.get(r.name), ...r }));
}

function groupByCategory(dishes) {
  const byCategory = {};
  for (const d of dishes) (byCategory[d.category] ||= []).push(d);
  return byCategory;
}

async function insertSchool(client, kombinatId, s, scale) {
  const school = await client.query(
    "INSERT INTO schools (kombinat_id, number, name) VALUES ($1, $2, $3) RETURNING id",
    [kombinatId, s.number, s.name]
  );
  const schoolId = school.rows[0].id;
  const director = await client.query(
    "INSERT INTO directors (school_id, full_name) VALUES ($1, $2) RETURNING id",
    [schoolId, s.director]
  );
  const classes = [];
  for (const c of buildClasses(Math.max(1, Math.round(s.students * scale)))) {
    const r = await client.query(
      "INSERT INTO classes (school_id, name, students_count) VALUES ($1, $2, $3) RETURNING id",
      [schoolId, c.name, c.students]
    );
    classes.push({ id: r.rows[0].id, students: c.students });
  }
  return { schoolId, directorId: director.rows[0].id, classes };
}

// Один учебный день школы: посещаемость, меню, подносы.
// planned - уже заказанное меню дня (Map dishId -> порций): тогда меню не создаём, только «едим».
async function insertDay(client, { schoolId, classes, date, menu, isBaseline, rand, planned: ordered = null }) {
  let present = 0;
  for (const c of classes) {
    const p = Math.round(c.students * clamp(BASE_ATTENDANCE + (rand() - 0.5) * 0.08, 0, 1));
    present += p;
    await client.query(
      "INSERT INTO attendance (class_id, date, present_count) VALUES ($1, $2, $3) ON CONFLICT (class_id, date) DO NOTHING",
      [c.id, date, p]
    );
  }
  const students = classes.reduce((a, c) => a + c.students, 0);
  const appetite = WEEKDAY_APPETITE[weekday(date)] || 1;

  // Заказ: «до системы» - по списку учеников, потом - по прогнозу (сколько детей возьмёт) с запасом.
  const planned = ordered || new Map(menu.map((d) => [
    d.id,
    isBaseline ? Math.round(students * BASELINE_ORDER_SHARE) : Math.ceil(present * d.take * (1 + ORDER_MARGIN))
  ]));
  if (!ordered) {
    for (const d of menu) {
      await client.query(
        "INSERT INTO menu_items (school_id, date, dish_id, planned_portions) VALUES ($1, $2, $3, $4)",
        [schoolId, date, d.id, planned.get(d.id)]
      );
    }
  }

  const scans = await client.query(
    `INSERT INTO tray_scans (school_id, scan_date, source)
     SELECT $1, $2, 'seed' FROM generate_series(1, $3) RETURNING id`,
    [schoolId, date, present]
  );
  const scanIds = [];
  const dishIds = [];
  const leftovers = [];
  const served = new Map();
  for (const { id: scanId } of scans.rows) {
    for (const d of menu) {
      if (rand() > d.take * appetite || (served.get(d.id) || 0) >= planned.get(d.id)) continue;
      served.set(d.id, (served.get(d.id) || 0) + 1);
      const eaten = clamp(d.eat * appetite + (rand() - 0.5) * 0.12, 0, 1);
      scanIds.push(scanId);
      dishIds.push(d.id);
      leftovers.push(Math.round((1 - eaten) * 100));
    }
  }
  await client.query(
    `INSERT INTO tray_items (scan_id, dish_id, leftover_pct)
     SELECT * FROM unnest($1::bigint[], $2::int[], $3::numeric[])`,
    [scanIds, dishIds, leftovers]
  );
  return planned;
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// Стартовые уведомления демо, чтобы колокольчик был не пустой.
async function insertEvent(client, { kombinatId, schoolId = null, audience, kind, text, link, minutesAgo }) {
  await client.query(
    `INSERT INTO events (kombinat_id, school_id, audience, kind, text, link, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() - make_interval(mins => $7))`,
    [kombinatId, schoolId, audience, kind, text, link, minutesAgo]
  );
}

// Школа с историей за days и меню на next. Возвращает id школы, директора и классы.
async function seedSchool(client, { kombinatId, s, days, next, byCategory, byName, scale, rand }) {
  const school = await insertSchool(client, kombinatId, s, scale);
  // Сколько порций каждого блюда заказывали после перехода на прогноз - это «обычно».
  const ordered = new Map();
  for (let i = 0; i < days.length; i++) {
    const isBaseline = i < BASELINE_SCHOOL_DAYS;
    const planned = await insertDay(client, { ...school, date: days[i], menu: menuForDay(i, byCategory), isBaseline, rand });
    if (isBaseline) continue;
    for (const [dishId, n] of planned) ordered.set(dishId, [...(ordered.get(dishId) || []), n]);
  }
  const students = school.classes.reduce((a, c) => a + c.students, 0);
  for (const name of NEXT_DAY_MENU) {
    const dish = byName.get(name);
    if (!dish) continue;
    const usual = Math.round(average(ordered.get(dish.id) || []) ?? students);
    await client.query(
      "INSERT INTO menu_items (school_id, date, dish_id, planned_portions) VALUES ($1, $2, $3, $4)",
      [school.schoolId, next, dish.id, usual]
    );
  }
  return school;
}

// Полностью пересоздаёт демо-данные. scale < 1 уменьшает школы (для тестов).
async function seed(client, { today, scale = 1 }) {
  const rand = prng(RANDOM_SEED);
  await resetAll(client);
  const { kombinatId, dishes } = await insertCatalog(client);

  const byCategory = groupByCategory(dishes);
  const byName = new Map(dishes.map((d) => [d.name, d]));

  const lastDay = isSchoolDay(today) ? today : previousSchoolDays(today, 1)[0];
  const days = previousSchoolDays(addDays(lastDay, 1), HISTORY_SCHOOL_DAYS);
  const next = nextSchoolDay(today);

  const links = { kombinat: (await createLink(client, { role: "kombinat", kombinatId })).url, directors: [] };
  for (const s of SCHOOLS) {
    const school = await seedSchool(client, { kombinatId, s, days, next, byCategory, byName, scale, rand });
    const link = await createLink(client, { role: "director", kombinatId, directorId: school.directorId });
    links.directors.push({ school: s.name, director: s.director, url: link.url });
    await insertEvent(client, {
      kombinatId, schoolId: school.schoolId, audience: "kombinat", kind: "menu_added", minutesAgo: 30 + links.directors.length * 7,
      text: `${s.name}: меню на ${dayLabel(next)} готово, заказ по прогнозу`,
      link: `/kombinat/products?date=${next}`
    });
  }
  const newDish = byName.get(NEXT_DAY_MENU[0]);
  await insertEvent(client, {
    kombinatId, audience: "director", kind: "dish_added", minutesAgo: 90,
    text: `В каталоге комбината блюдо «${newDish.name}» - можно добавить в меню`,
    link: `/director/menu?add=${newDish.id}`
  });
  return { kombinatId, links, days: { from: days[0], to: lastDay, next } };
}

// Сколько порций блюда школа заказывала в последние 30 дней - «обычный» заказ.
async function usualOrders(client, schoolId, before) {
  const { rows } = await client.query(
    `SELECT dish_id, ROUND(AVG(planned_portions))::int AS usual
       FROM menu_items WHERE school_id = $1 AND date < $2 AND date >= $3
      GROUP BY dish_id`,
    [schoolId, before, addDays(before, -30)]
  );
  return new Map(rows.map((r) => [r.dish_id, r.usual]));
}

// Догоняет демо до today: недостающие школы из demoData (с историей), учебные дни
// без единого скана (подносы по уже заказанному меню или по циклу) и меню на следующий день.
// Ничего не стирает: настоящие сканы и правки меню остаются. Возвращает число дописанных дней.
async function topUpDemo(client, { today, scale = 1 }) {
  const k = await client.query("SELECT id FROM kombinats ORDER BY id LIMIT 1");
  if (!k.rows[0]) return 0;
  const kombinatId = k.rows[0].id;
  const dishes = await loadCatalog(client, kombinatId);
  const byCategory = groupByCategory(dishes);
  if (!["soup", "main", "side", "salad", "drink"].every((c) => byCategory[c]?.length)) return 0;
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const byName = new Map(dishes.map((d) => [d.name, d]));
  const lastDay = isSchoolDay(today) ? today : previousSchoolDays(today, 1)[0];
  const next = nextSchoolDay(today);

  const existing = await client.query("SELECT number FROM schools WHERE kombinat_id = $1", [kombinatId]);
  const numbers = new Set(existing.rows.map((r) => r.number));
  for (const s of SCHOOLS.filter((item) => !numbers.has(item.number))) {
    const days = previousSchoolDays(addDays(lastDay, 1), HISTORY_SCHOOL_DAYS);
    await seedSchool(client, { kombinatId, s, days, next, byCategory, byName, scale, rand: prng(RANDOM_SEED + s.number) });
  }

  let added = 0;
  const schools = await client.query(
    `SELECT s.id, MAX(ts.scan_date)::text AS last_scan
       FROM schools s LEFT JOIN tray_scans ts ON ts.school_id = s.id
      WHERE s.kombinat_id = $1 GROUP BY s.id`,
    [kombinatId]
  );
  for (const { id: schoolId, last_scan: lastScan } of schools.rows) {
    const classes = (await client.query("SELECT id, students_count AS students FROM classes WHERE school_id = $1", [schoolId])).rows;
    // Школы без истории (заведённые вручную) не трогаем: им нечего «продолжать».
    if (!classes.length || !lastScan) continue;
    const days = [];
    for (let d = nextSchoolDay(lastScan); d <= lastDay && days.length < MAX_TOP_UP_SCHOOL_DAYS; d = nextSchoolDay(d)) days.push(d);

    for (const date of days) {
      const rand = prng(RANDOM_SEED + schoolId * 100003 + dayNumber(date));
      const menuRows = (await client.query("SELECT dish_id, planned_portions FROM menu_items WHERE school_id = $1 AND date = $2", [schoolId, date])).rows;
      const known = menuRows.filter((r) => byId.has(r.dish_id));
      if (known.length) {
        const planned = new Map(known.map((r) => [r.dish_id, r.planned_portions]));
        await insertDay(client, { schoolId, classes, date, menu: known.map((r) => byId.get(r.dish_id)), isBaseline: false, rand, planned });
      } else {
        await insertDay(client, { schoolId, classes, date, menu: menuForDay(dayNumber(date), byCategory), isBaseline: false, rand });
      }
      added++;
    }

    const hasNext = await client.query("SELECT 1 FROM menu_items WHERE school_id = $1 AND date = $2 LIMIT 1", [schoolId, next]);
    if (!hasNext.rows.length) {
      const usual = await usualOrders(client, schoolId, next);
      const students = classes.reduce((a, c) => a + c.students, 0);
      for (const d of menuForDay(dayNumber(next), byCategory)) {
        await client.query(
          "INSERT INTO menu_items (school_id, date, dish_id, planned_portions) VALUES ($1, $2, $3, $4)",
          [schoolId, next, d.id, usual.get(d.id) ?? Math.round(students * d.take)]
        );
      }
    }
  }
  return added;
}

module.exports = { seed, topUpDemo, buildClasses, prng };
