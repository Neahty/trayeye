// Кабинет комбината питания: свои школы, личные ссылки директорам, каталог блюд,
// поставщики и сводная статистика. Всё ограничено req.cabinet.kombinatId.

const express = require("express");
const db = require("../db");
const { cabinetAuth } = require("../middleware/cabinetAuth");
const { schoolOverviews } = require("../services/overview");
const { createLink } = require("../services/links");
const data = require("../services/schoolData");
const metrics = require("../services/metrics");
const { dateParam, periodParams } = require("../utils/params");
const { parseId, parseIntInRange, parseText, badRequest } = require("../utils/http");

const router = express.Router();
router.use(cabinetAuth("kombinat"));

const MAX_NAME = 120;
const MAX_URL = 500;
const MAX_SCHOOL_NUMBER = 100000;
const MAX_PORTION_GRAMS = 5000;
const MAX_PORTION_PRICE = 100000;
const DISH_CATEGORIES = ["soup", "main", "side", "salad", "drink", "bakery", "other"];
const GRAMS_PER_KG = 1000;

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

function kombinatInfo(cabinet) {
  return { id: cabinet.kombinatId, name: cabinet.kombinatName };
}

router.get("/dashboard", async (req, res, next) => {
  try {
    const date = dateParam(req, res);
    if (!date) return;
    const schools = await schoolsOf(req.cabinet.kombinatId);
    const overviews = schools.length ? await schoolOverviews(schools.map((s) => s.id), date) : new Map();
    const list = schools.map((s) => ({ ...s, ...overviews.get(s.id) }));

    const present = list.reduce((a, s) => a + s.cards.kids.present, 0);
    const students = list.reduce((a, s) => a + s.cards.kids.students, 0);
    res.json({
      kombinat: kombinatInfo(req.cabinet),
      date,
      totals: {
        savingsRub: list.reduce((a, s) => a + s.cards.savings.rub, 0),
        wasteRub: metrics.round(list.reduce((a, s) => a + s.cards.waste.rub, 0), 2),
        kids: metrics.kidsSummary(present, students),
        schools: list.length
      },
      schools: list
    });
  } catch (err) {
    next(err);
  }
});

router.get("/schools", async (req, res, next) => {
  try {
    res.json({ schools: await schoolsOf(req.cabinet.kombinatId) });
  } catch (err) {
    next(err);
  }
});

// Личная ссылка директору: ФИО + номер школы. Школа и директор создаются, если их нет.
router.post("/links", async (req, res, next) => {
  try {
    const fullName = parseText(req.body?.full_name, MAX_NAME);
    const number = parseIntInRange(req.body?.school_number, 1, MAX_SCHOOL_NUMBER);
    const schoolName = req.body?.school_name === undefined ? null : parseText(req.body.school_name, MAX_NAME);
    if (!fullName || !number || (req.body?.school_name !== undefined && !schoolName)) {
      return badRequest(res, "bad_link_request");
    }

    const result = await db.withTx(async (client) => {
      const school = await client.query(
        `INSERT INTO schools (kombinat_id, number, name) VALUES ($1, $2, $3)
         ON CONFLICT (kombinat_id, number) DO UPDATE SET name = COALESCE($4, schools.name)
         RETURNING id, number, name`,
        [req.cabinet.kombinatId, number, schoolName || `Школа №${number}`, schoolName]
      );
      const director = await client.query(
        `INSERT INTO directors (school_id, full_name) VALUES ($1, $2)
         ON CONFLICT (school_id) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id, full_name`,
        [school.rows[0].id, fullName]
      );
      const link = await createLink(client, {
        role: "director", kombinatId: req.cabinet.kombinatId, directorId: director.rows[0].id
      });
      return { school: school.rows[0], director: director.rows[0], link };
    });

    res.status(201).json({
      school: result.school,
      director: result.director,
      link: { id: result.link.id, url: result.link.url }
    });
  } catch (err) {
    next(err);
  }
});

router.get("/links", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT l.id, l.role, l.created_at, l.last_used_at, l.revoked_at,
              d.full_name AS director_name, s.number AS school_number, s.name AS school_name
         FROM access_links l
         LEFT JOIN directors d ON d.id = l.director_id
         LEFT JOIN schools s ON s.id = d.school_id
        WHERE l.kombinat_id = $1
        ORDER BY l.created_at DESC`,
      [req.cabinet.kombinatId]
    );
    res.json({ links: rows });
  } catch (err) {
    next(err);
  }
});

// Отзыв ссылки сразу закрывает все сессии, открытые по ней.
router.delete("/links/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return badRequest(res, "bad_id");
    if (id === req.cabinet.linkId) return badRequest(res, "cannot_revoke_own_link");
    const { rowCount } = await db.query(
      `UPDATE access_links SET revoked_at = NOW()
        WHERE id = $1 AND kombinat_id = $2 AND revoked_at IS NULL`,
      [id, req.cabinet.kombinatId]
    );
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// «Меню товаров»: сколько каждого блюда нужно на день по всем школам.
router.get("/products", async (req, res, next) => {
  try {
    const date = dateParam(req, res);
    if (!date) return;
    const { rows } = await db.query(
      `SELECT d.id AS dish_id, d.name, d.category, d.image_url, d.portion_grams,
              sp.name AS supplier_name,
              SUM(m.planned_portions)::int AS portions,
              ARRAY_AGG(s.number ORDER BY s.number) AS school_numbers
         FROM menu_items m
         JOIN dishes d ON d.id = m.dish_id
         JOIN schools s ON s.id = m.school_id
         LEFT JOIN suppliers sp ON sp.id = d.supplier_id
        WHERE s.kombinat_id = $1 AND m.date = $2
        GROUP BY d.id, sp.name`,
      [req.cabinet.kombinatId, date]
    );
    const products = rows
      .map((r) => ({ ...r, weightKg: metrics.round((r.portions * r.portion_grams) / GRAMS_PER_KG, 1) }))
      .sort(metrics.byCategoryThenName);
    res.json({ date, products });
  } catch (err) {
    next(err);
  }
});

router.get("/dishes", async (req, res, next) => {
  try {
    res.json({ dishes: await data.listDishes(req.cabinet.kombinatId), categories: DISH_CATEGORIES });
  } catch (err) {
    next(err);
  }
});

// Поля блюда из тела запроса. null - что-то не так.
function parseDish(body) {
  const name = parseText(body?.name, MAX_NAME);
  const category = DISH_CATEGORIES.includes(body?.category) ? body.category : null;
  const grams = parseIntInRange(body?.portion_grams, 1, MAX_PORTION_GRAMS);
  const price = Number(body?.portion_price);
  const supplierId = body?.supplier_id == null ? null : parseId(body.supplier_id);
  const imageUrl = body?.image_url ? parseText(body.image_url, MAX_URL) : null;
  if (!name || !category || !grams || !Number.isFinite(price) || price < 0 || price > MAX_PORTION_PRICE) return null;
  if (body?.supplier_id != null && !supplierId) return null;
  if (body?.image_url && (!imageUrl || !/^(https?:\/\/|\/)/.test(imageUrl))) return null;
  return { name, category, grams, price, supplierId, imageUrl };
}

async function supplierBelongs(supplierId, kombinatId) {
  if (!supplierId) return true;
  const { rows } = await db.query("SELECT 1 FROM suppliers WHERE id = $1 AND kombinat_id = $2", [supplierId, kombinatId]);
  return rows.length > 0;
}

router.post("/dishes", async (req, res, next) => {
  try {
    const d = parseDish(req.body);
    if (!d) return badRequest(res, "bad_dish");
    if (!(await supplierBelongs(d.supplierId, req.cabinet.kombinatId))) return badRequest(res, "bad_supplier");
    const { rows } = await db.query(
      `INSERT INTO dishes (kombinat_id, supplier_id, name, category, image_url, portion_grams, portion_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (kombinat_id, name) DO NOTHING
       RETURNING id`,
      [req.cabinet.kombinatId, d.supplierId, d.name, d.category, d.imageUrl, d.grams, d.price]
    );
    if (!rows[0]) return res.status(409).json({ error: "dish_exists" });
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

router.put("/dishes/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const d = parseDish(req.body);
    if (!id || !d) return badRequest(res, "bad_dish");
    if (!(await supplierBelongs(d.supplierId, req.cabinet.kombinatId))) return badRequest(res, "bad_supplier");
    const { rowCount } = await db.query(
      `UPDATE dishes SET supplier_id = $3, name = $4, category = $5, image_url = $6,
              portion_grams = $7, portion_price = $8
        WHERE id = $1 AND kombinat_id = $2`,
      [id, req.cabinet.kombinatId, d.supplierId, d.name, d.category, d.imageUrl, d.grams, d.price]
    );
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "dish_exists" });
    next(err);
  }
});

router.get("/suppliers", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.name, COUNT(d.id)::int AS dishes
         FROM suppliers s
         LEFT JOIN dishes d ON d.supplier_id = s.id
        WHERE s.kombinat_id = $1
        GROUP BY s.id
        ORDER BY s.name`,
      [req.cabinet.kombinatId]
    );
    res.json({ suppliers: rows });
  } catch (err) {
    next(err);
  }
});

router.post("/suppliers", async (req, res, next) => {
  try {
    const name = parseText(req.body?.name, MAX_NAME);
    if (!name) return badRequest(res, "bad_supplier");
    const { rows } = await db.query(
      `INSERT INTO suppliers (kombinat_id, name) VALUES ($1, $2)
       ON CONFLICT (kombinat_id, name) DO NOTHING RETURNING id`,
      [req.cabinet.kombinatId, name]
    );
    if (!rows[0]) return res.status(409).json({ error: "supplier_exists" });
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

// Статистика по всем школам комбината за период.
router.get("/stats", async (req, res, next) => {
  try {
    const period = periodParams(req, res);
    if (!period) return;
    const schools = await schoolsOf(req.cabinet.kombinatId);
    const ids = schools.map((s) => s.id);
    const [rows, attendance, students] = await Promise.all([
      data.dishDays(ids, period.from, period.to),
      data.attendanceDays(ids, period.from, period.to),
      data.studentsBySchool(ids)
    ]);
    const totalStudents = [...students.values()].reduce((a, b) => a + b, 0);
    const presentByDate = new Map();
    for (const a of attendance) presentByDate.set(a.date, (presentByDate.get(a.date) || 0) + a.present);

    res.json({
      ...period,
      summary: metrics.wasteSummary(rows),
      series: metrics.dailySeries(
        rows,
        [...presentByDate].map(([date, present]) => ({ date, present })),
        totalStudents
      ),
      schools: schools.map((s) => ({
        id: s.id,
        number: s.number,
        name: s.name,
        ...metrics.wasteSummary(rows.filter((r) => r.school_id === s.id))
      })),
      dishes: metrics.dishStats(rows)
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
