// Кабинет директора школы. Все запросы ограничены школой директора (req.cabinet.schoolId).

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { cabinetAuth } = require("../middleware/cabinetAuth");
const { schoolOverview, schoolStats } = require("../services/overview");
const data = require("../services/schoolData");
const metrics = require("../services/metrics");
const vision = require("../services/vision");
const events = require("../services/events");
const { today } = require("../utils/dates");
const { dateParam, periodParams } = require("../utils/params");
const { parseId, parseIntInRange, parseDate, badRequest } = require("../utils/http");
const { imageUpload, extFor, uploadErrors } = require("../utils/imageUpload");
const { videoUpload, videoErrors } = require("../utils/videoUpload");
const camera = require("../services/camera");
const { UPLOADS_ROOT } = require("../config");

const router = express.Router();
router.use(cabinetAuth("director"));

const MAX_PORTIONS = 5000;
const MAX_TRAY_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_CAMERA_VIDEO_BYTES = 200 * 1024 * 1024;
const upload = imageUpload(MAX_TRAY_PHOTO_BYTES);
// Папку берём при каждом запросе: в тестах UPLOADS_DIR задаётся до загрузки модулей, но так надёжнее.
const uploadVideo = (req, res, next) => videoUpload(MAX_CAMERA_VIDEO_BYTES, camera.inboxDir()).single("video")(req, res, next);

function profile(cabinet) {
  return {
    director: { fullName: cabinet.fullName, avatarUrl: cabinet.avatarUrl },
    school: { id: cabinet.schoolId, number: cabinet.schoolNumber, name: cabinet.schoolName },
    kombinat: { id: cabinet.kombinatId, name: cabinet.kombinatName }
  };
}

router.get("/dashboard", async (req, res, next) => {
  try {
    const date = dateParam(req, res);
    if (!date) return;
    res.json({ ...profile(req.cabinet), ...(await schoolOverview(req.cabinet.schoolId, date)) });
  } catch (err) {
    next(err);
  }
});

// Меню на день: блюдо, сколько порций заказано, сколько съедают.
router.get("/menu", async (req, res, next) => {
  try {
    const date = dateParam(req, res);
    if (!date) return;
    const [rows, ids] = await Promise.all([
      data.dishDays([req.cabinet.schoolId], date, date),
      db.query("SELECT id, dish_id FROM menu_items WHERE school_id = $1 AND date = $2", [req.cabinet.schoolId, date])
    ]);
    const itemId = new Map(ids.rows.map((r) => [r.dish_id, r.id]));
    const items = rows
      .map((r) => ({
        id: itemId.get(r.dish_id),
        dish_id: r.dish_id,
        name: r.name,
        category: r.category,
        image_url: r.image_url,
        planned: r.planned,
        trays: r.trays,
        eatenPct: metrics.eatenPct(r)
      }))
      .sort(metrics.byCategoryThenName);
    res.json({ date, items });
  } catch (err) {
    next(err);
  }
});

// «Добавить меню»: блюдо из каталога комбината на дату (повтор - обновляет порции).
router.post("/menu", async (req, res, next) => {
  try {
    const date = parseDate(req.body?.date);
    const dishId = parseId(req.body?.dish_id);
    const planned = parseIntInRange(req.body?.planned_portions, 0, MAX_PORTIONS);
    if (!date || !dishId || planned === null) return badRequest(res, "bad_menu_item");

    const dish = await db.query("SELECT id, name FROM dishes WHERE id = $1 AND kombinat_id = $2", [dishId, req.cabinet.kombinatId]);
    if (!dish.rows[0]) return res.status(404).json({ error: "dish_not_found" });

    const { rows } = await db.query(
      `INSERT INTO menu_items (school_id, date, dish_id, planned_portions) VALUES ($1, $2, $3, $4)
       ON CONFLICT (school_id, date, dish_id) DO UPDATE SET planned_portions = EXCLUDED.planned_portions
       RETURNING id, date, dish_id, planned_portions`,
      [req.cabinet.schoolId, date, dishId, planned]
    );
    await events.record(db, {
      kombinatId: req.cabinet.kombinatId,
      schoolId: req.cabinet.schoolId,
      audience: "kombinat",
      kind: "menu_added",
      text: `${events.schoolLabel(req.cabinet)}: в меню на ${events.dayLabel(date)} добавили «${dish.rows[0].name}», ${planned} порц.`,
      link: `/kombinat/products?date=${date}&focus=dish-${dishId}`
    });
    res.status(201).json({ item: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete("/menu/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return badRequest(res, "bad_id");
    const { rows } = await db.query(
      `DELETE FROM menu_items WHERE id = $1 AND school_id = $2
       RETURNING date, (SELECT name FROM dishes WHERE dishes.id = menu_items.dish_id) AS name`,
      [id, req.cabinet.schoolId]
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    await events.record(db, {
      kombinatId: req.cabinet.kombinatId,
      schoolId: req.cabinet.schoolId,
      audience: "kombinat",
      kind: "menu_removed",
      text: `${events.schoolLabel(req.cabinet)}: из меню на ${events.dayLabel(rows[0].date)} убрали «${rows[0].name}»`,
      link: `/kombinat/products?date=${rows[0].date}`
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Каталог блюд комбината - для выбора в «Добавить меню».
router.get("/dishes", async (req, res, next) => {
  try {
    res.json({ dishes: await data.listDishes(req.cabinet.kombinatId) });
  } catch (err) {
    next(err);
  }
});

// Применить прогноз: заказ на следующий учебный день = прогнозу.
router.post("/forecast/apply", async (req, res, next) => {
  try {
    const overview = await schoolOverview(req.cabinet.schoolId, today());
    const { date, items } = overview.forecast;
    await db.withTx(async (client) => {
      for (const it of items) {
        await client.query(
          "UPDATE menu_items SET planned_portions = $1 WHERE school_id = $2 AND date = $3 AND dish_id = $4",
          [it.forecast, req.cabinet.schoolId, date, it.dish_id]
        );
      }
    });
    if (items.length) {
      await events.record(db, {
        kombinatId: req.cabinet.kombinatId,
        schoolId: req.cabinet.schoolId,
        audience: "kombinat",
        kind: "forecast_applied",
        text: `${events.schoolLabel(req.cabinet)}: заказ на ${events.dayLabel(date)} пересчитан по прогнозу`,
        link: `/kombinat/products?date=${date}`
      });
    }
    res.json({ date, updated: items.length });
  } catch (err) {
    next(err);
  }
});

router.get("/classes", async (req, res, next) => {
  try {
    const date = dateParam(req, res);
    if (!date) return;
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.students_count, a.present_count
         FROM classes c
         LEFT JOIN attendance a ON a.class_id = c.id AND a.date = $2
        WHERE c.school_id = $1
        ORDER BY length(c.name), c.name`,
      [req.cabinet.schoolId, date]
    );
    res.json({ date, classes: rows });
  } catch (err) {
    next(err);
  }
});

// Отметить, сколько детей пришло в класс.
router.put("/classes/:id/attendance", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const date = parseDate(req.body?.date);
    const present = parseIntInRange(req.body?.present_count, 0, MAX_PORTIONS);
    if (!id || !date || present === null) return badRequest(res, "bad_attendance");

    const cls = await db.query("SELECT students_count FROM classes WHERE id = $1 AND school_id = $2", [id, req.cabinet.schoolId]);
    if (!cls.rows[0]) return res.status(404).json({ error: "not_found" });
    if (present > cls.rows[0].students_count) return badRequest(res, "present_exceeds_students");

    await db.query(
      `INSERT INTO attendance (class_id, date, present_count) VALUES ($1, $2, $3)
       ON CONFLICT (class_id, date) DO UPDATE SET present_count = EXCLUDED.present_count`,
      [id, date, present]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/stats", async (req, res, next) => {
  try {
    const period = periodParams(req, res);
    if (!period) return;
    res.json(await schoolStats(req.cabinet.schoolId, period));
  } catch (err) {
    next(err);
  }
});

// Демо камеры: загрузить фото подноса, ИИ определит блюда и остатки.
router.post("/tray", upload.single("image"), uploadErrors, async (req, res, next) => {
  try {
    if (!req.file) return badRequest(res, "no_image");
    const date = req.body?.date === undefined ? today() : parseDate(req.body.date);
    if (!date) return badRequest(res, "bad_date");

    const schoolId = req.cabinet.schoolId;
    const menu = await data.dishDays([schoolId], date, date);
    if (!menu.length) return res.status(409).json({ error: "no_menu_for_date" });

    const result = await vision.analyzeTray({ buffer: req.file.buffer, mime: req.file.mimetype, menu });

    const dir = path.join(UPLOADS_ROOT, "trays", String(schoolId));
    await fs.promises.mkdir(dir, { recursive: true });
    // Случайная часть в имени: путь к фото не угадать перебором времени.
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${extFor(req.file.mimetype)}`;
    await fs.promises.writeFile(path.join(dir, filename), req.file.buffer);
    const photoPath = `trays/${schoolId}/${filename}`;

    const scan = await db.withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO tray_scans (school_id, scan_date, photo_path, source, ai_model)
         VALUES ($1, $2, $3, 'upload', $4) RETURNING id, scan_date, photo_path`,
        [schoolId, date, photoPath, result.model]
      );
      for (const it of result.items) {
        await client.query(
          "INSERT INTO tray_items (scan_id, dish_id, leftover_pct) VALUES ($1, $2, $3)",
          [rows[0].id, it.dish_id, it.leftover_pct]
        );
      }
      return rows[0];
    });

    await events.record(db, {
      kombinatId: req.cabinet.kombinatId,
      schoolId,
      audience: "kombinat",
      kind: "tray_scanned",
      text: `${events.schoolLabel(req.cabinet)}: распознан поднос за ${events.dayLabel(date)}`,
      link: `/kombinat/schools/${schoolId}`
    });
    const names = new Map(menu.map((m) => [m.dish_id, m.name]));
    res.status(201).json({
      scan,
      items: result.items.map((it) => ({ ...it, name: names.get(it.dish_id) }))
    });
  } catch (err) {
    next(err);
  }
});

// Демо камеры над лентой: видео -> локальная модель находит подносы -> пустые записываем
// сразу, в ИИ уходят только подносы с остатками.
router.post("/camera/video", uploadVideo, videoErrors, async (req, res, next) => {
  const file = req.file;
  // Видео не храним: оно большое, а нужны только кадры подносов.
  const removeVideo = () => (file ? fs.promises.unlink(file.path).catch(() => {}) : null);
  try {
    if (!file) return badRequest(res, "no_video");
    const date = req.body?.date === undefined ? today() : parseDate(req.body.date);
    if (!date) return badRequest(res, "bad_date");

    const schoolId = req.cabinet.schoolId;
    const menu = await data.dishDays([schoolId], date, date);
    if (!menu.length) return res.status(409).json({ error: "no_menu_for_date" });

    const started = Date.now();
    const found = await camera.analyzeVideo(file.path);
    await removeVideo();
    const { trays, aiRequests } = await camera.recordTrays({ schoolId, date, menu, trays: found.trays });
    const saved = trays.filter((t) => t.scan_id);

    if (saved.length) {
      await events.record(db, {
        kombinatId: req.cabinet.kombinatId,
        schoolId,
        audience: "kombinat",
        kind: "tray_scanned",
        text: `${events.schoolLabel(req.cabinet)}: камера распознала подносов - ${saved.length} за ${events.dayLabel(date)}`,
        link: `/kombinat/schools/${schoolId}`
      });
    }
    res.status(201).json({
      date,
      stats: {
        frames: found.frames,
        ms_per_frame: found.ms_per_frame,
        trays: trays.length,
        skipped_ai: trays.filter((t) => t.is_empty).length,
        sent_to_ai: trays.filter((t) => t.gpt).length,
        ai_requests: aiRequests,
        failed: trays.filter((t) => t.error).length,
        seconds: Math.round((Date.now() - started) / 100) / 10
      },
      trays
    });
  } catch (err) {
    next(err);
  } finally {
    await removeVideo();
  }
});

// «Отправить в комбинат»: отчёт приходит комбинату уведомлением со ссылкой на данные школы.
// Текст собирает сервер - директор присылает только тип и даты.
router.post("/reports", async (req, res, next) => {
  try {
    const school = events.schoolLabel(req.cabinet);
    let text;
    let link = `/kombinat/schools/${req.cabinet.schoolId}`;
    if (req.body?.type === "attendance") {
      const date = parseDate(req.body?.date);
      if (!date) return badRequest(res, "bad_report");
      text = `${school}: отчёт о посещаемости за ${events.dayLabel(date)}`;
    } else if (req.body?.type === "stats") {
      const from = parseDate(req.body?.from);
      const to = parseDate(req.body?.to);
      if (!from || !to || from > to) return badRequest(res, "bad_report");
      text = `${school}: отчёт за период ${events.dayLabel(from)} - ${events.dayLabel(to)}`;
      link += `?from=${from}&to=${to}`;
    } else {
      return badRequest(res, "bad_report");
    }
    await events.record(db, { kombinatId: req.cabinet.kombinatId, schoolId: req.cabinet.schoolId, audience: "kombinat", kind: "report", text, link });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Уведомления директора: новое в каталоге комбината и события его школы.
router.get("/notifications", async (req, res, next) => {
  try {
    res.json({ events: await events.feed(req.cabinet) });
  } catch (err) {
    next(err);
  }
});

// Фото подноса - только директору своей школы. Публичной раздачи uploads/ нет:
// на снимках бывают дети.
router.get("/tray/:id/photo", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return badRequest(res, "bad_id");
    const { rows } = await db.query(
      "SELECT photo_path FROM tray_scans WHERE id = $1 AND school_id = $2 AND photo_path IS NOT NULL",
      [id, req.cabinet.schoolId]
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    res.sendFile(path.join(UPLOADS_ROOT, rows[0].photo_path), { dotfiles: "deny" }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "not_found" });
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
