const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const auth = require("../middleware/auth");
const checkLimit = require("../middleware/checkLimit");
const rateLimit = require("../middleware/rateLimit");
const { analyzeImage, analyzeText, VISION_MODEL, TEXT_MODEL } = require("../services/openai");
const aiUsage = require("../services/aiUsage");
const { notifyTrainerOfClientScan } = require("../services/notify");
const channelLog = require("../services/channelLog");
const { parseId } = require("../utils/http");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Базовый публичный адрес — чтобы Telegram мог скачать фото скана по URL (через Caddy /uploads).
const SERVER_URL = process.env.SERVER_URL || process.env.CLIENT_URL || "";

const UPLOADS_ROOT = path.resolve(__dirname, "../../../uploads");
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];

function savePhoto(userId, buffer, ext) {
  const dir = path.join(UPLOADS_ROOT, "users", String(userId));
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `uploads/users/${userId}/${filename}`;
}

async function insertScan(userId, dish, mealType, photoPath, source, batchId) {
  const { rows } = await db.query(
    `INSERT INTO scans (user_id, dish_name, calories, protein, fat, carbs, weight_grams, meal_type, is_manual, photo_path, ai_confidence, source, batch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [userId, dish.dish_name, dish.calories, dish.protein, dish.fat, dish.carbs,
     dish.weight_grams, mealType, source !== "photo", photoPath || null,
     dish.confidence || null, source, batchId || null]
  );
  return rows[0];
}

// Фолбэк-подсказки для новичка, если в базе ещё мало блюд (свежая установка).
const FALLBACK_POPULAR = ["Овсянка на молоке", "Куриная грудка с рисом", "Греческий салат", "Гречка с овощами"];

// Кэш глобального топа популярных блюд: тяжёлый GROUP BY по всей таблице — не на каждый запрос.
let popularCache = { at: 0, list: null };
const POPULAR_TTL = 60 * 60 * 1000; // 1 час

async function getPopular() {
  if (popularCache.list && Date.now() - popularCache.at < POPULAR_TTL) return popularCache.list;
  const { rows } = await db.query(
    `SELECT dish_name FROM scans
     WHERE dish_name IS NOT NULL AND btrim(dish_name) <> '' AND dish_name <> 'Блюдо'
     GROUP BY dish_name ORDER BY COUNT(*) DESC LIMIT 4`
  );
  const list = rows.map((r) => r.dish_name);
  const result = list.length >= 4 ? list : FALLBACK_POPULAR;
  popularCache = { at: Date.now(), list: result };
  return result;
}

// GET /api/scan/suggestions  — подсказки-чипы для ввода текстом.
// recent — последние уникальные блюда пользователя (любой источник); popular — глобальный топ (для новичка).
router.get("/suggestions", auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT dish_name, MAX(scanned_at) AS last_at FROM scans
       WHERE user_id = $1 AND dish_name IS NOT NULL AND btrim(dish_name) <> '' AND dish_name <> 'Блюдо'
       GROUP BY dish_name ORDER BY last_at DESC LIMIT 6`,
      [req.user.id]
    );
    const recent = rows.map((r) => r.dish_name);
    const popular = await getPopular();
    res.json({ recent, popular });
  } catch (err) {
    next(err);
  }
});

// POST /api/scan  (multipart: image + meal_type)
router.post("/", auth, rateLimit, checkLimit, upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no_image" });
    const mealType = MEAL_TYPES.includes(req.body.meal_type) ? req.body.meal_type : "snack";

    const startedAt = Date.now();
    let result;
    try {
      result = await analyzeImage(req.file.buffer, req.file.mimetype);
    } catch (err) {
      await aiUsage.record({
        userId: req.user.id, kind: "image", model: err.model || VISION_MODEL,
        usage: err.usage, latencyMs: Date.now() - startedAt, status: "error", error: err.message
      });
      await db.logAction(req.user.id, "error", { where: "scan", message: err.message });
      channelLog.logError("scan", err.message).catch(() => {});
      const status = err.status || 502;
      return res.status(status).json({ error: "ai_failed" });
    }
    const latencyMs = Date.now() - startedAt;

    const ext = (req.file.mimetype.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const photoPath = savePhoto(req.user.id, req.file.buffer, ext);

    // Один id приёма на всё фото — блюда склеиваются в одну карточку.
    const batchId = crypto.randomUUID();
    const saved = [];
    for (const dish of result.dishes) {
      saved.push(await insertScan(req.user.id, dish, mealType, photoPath, "photo", batchId));
    }

    await aiUsage.record({
      userId: req.user.id, scanId: saved[0]?.id, kind: "image",
      model: result.model, usage: result.usage, latencyMs, status: "ok",
      // Для диагностики: пометка, если сработал запасной вариант (не засоряет список ошибок).
      error: result.fallback ? `fallback (finish=${result.finish_reason || "?"})` : null
    });
    await db.logAction(req.user.id, "scan", { count: saved.length, meal_type: mealType, source: "photo", fallback: result.fallback || false });
    notifyTrainerOfClientScan(req.user).catch(() => {});

    // Дублируем фото-скан в Telegram-канал (если включено в настройках): само фото + что распознали.
    try {
      const dishes = saved.map((s) => s.dish_name).filter(Boolean);
      const totalCal = saved.reduce((a, s) => a + (s.calories || 0), 0);
      const who = req.user.username ? `@${req.user.username}` : (req.user.name || `#${req.user.id}`);
      const photoUrl = SERVER_URL ? `${SERVER_URL.replace(/\/$/, "")}/${photoPath}` : null;
      if (photoUrl) {
        const caption =
          `🍽 <b>Фото-скан еды</b>\n` +
          `Пользователь: ${channelLog.esc(who)}\n` +
          `Блюдо: ${channelLog.esc(dishes.join(", ") || "—")}\n` +
          `Калории: ${totalCal} ккал`;
        channelLog.postPhotoFor("scans_photo", req.user.id, photoUrl, caption).catch(() => {});
      }
    } catch { /* канал не критичен для скана */ }

    res.json({ scans: saved, low_confidence: result.low_confidence });
  } catch (err) {
    next(err);
  }
});

// POST /api/scan/text  { description, meal_type }  — AI считает КБЖУ по описанию
router.post("/text", auth, rateLimit, checkLimit, async (req, res, next) => {
  try {
    const description = String(req.body?.description || "").trim();
    if (!description) return res.status(400).json({ error: "description_required" });
    const mealType = MEAL_TYPES.includes(req.body.meal_type) ? req.body.meal_type : "snack";

    const startedAt = Date.now();
    let result;
    try {
      result = await analyzeText(description);
    } catch (err) {
      await aiUsage.record({
        userId: req.user.id, kind: "text", model: err.model || TEXT_MODEL,
        usage: err.usage, latencyMs: Date.now() - startedAt, status: "error", error: err.message
      });
      await db.logAction(req.user.id, "error", { where: "scan_text", message: err.message });
      channelLog.logError("scan_text", err.message).catch(() => {});
      const status = err.status === 422 ? 422 : err.status || 502;
      return res.status(status).json({ error: status === 422 ? "not_recognized" : "ai_failed" });
    }
    const latencyMs = Date.now() - startedAt;

    // Один id приёма на весь текстовый ввод — несколько блюд = одна карточка.
    const batchId = crypto.randomUUID();
    const saved = [];
    for (const dish of result.dishes) {
      saved.push(await insertScan(req.user.id, dish, mealType, null, "text", batchId));
    }

    await aiUsage.record({
      userId: req.user.id, scanId: saved[0]?.id, kind: "text",
      model: result.model, usage: result.usage, latencyMs, status: "ok",
      error: result.fallback ? `fallback (finish=${result.finish_reason || "?"})` : null
    });
    await db.logAction(req.user.id, "scan", { count: saved.length, meal_type: mealType, source: "text", fallback: result.fallback || false });
    notifyTrainerOfClientScan(req.user).catch(() => {});

    res.json({ scans: saved, scan: saved[0], low_confidence: result.low_confidence });
  } catch (err) {
    next(err);
  }
});

// POST /api/scan/manual  — ручной ввод КБЖУ без AI
router.post("/manual", auth, checkLimit, async (req, res, next) => {
  try {
    const { dish_name, calories, protein, fat, carbs, weight_grams, meal_type } = req.body || {};
    if (!dish_name) return res.status(400).json({ error: "dish_name_required" });
    const mealType = MEAL_TYPES.includes(meal_type) ? meal_type : "snack";

    const dish = {
      dish_name,
      calories: Math.round(Number(calories) || 0),
      protein: Number(protein) || 0,
      fat: Number(fat) || 0,
      carbs: Number(carbs) || 0,
      weight_grams: Number(weight_grams) || 0
    };
    const saved = await insertScan(req.user.id, dish, mealType, null, "manual", crypto.randomUUID());
    await db.logAction(req.user.id, "scan", { manual: true });
    notifyTrainerOfClientScan(req.user).catch(() => {});

    res.json({ scan: saved });
  } catch (err) {
    next(err);
  }
});

// Число из формы редактирования. Пусто/undefined — поле не меняем (null для COALESCE),
// мусор или отрицательное — NaN, чтобы ответить 400. calories в схеме INT, поэтому
// дробное значение округляем: иначе Postgres валит запрос в 500.
function numOrNull(v, round = false) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return round ? Math.round(n) : n;
}

// PATCH /api/scan/:id
router.patch("/:id", auth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "bad_id" });
    const { dish_name, calories, protein, fat, carbs, weight_grams, meal_type } = req.body || {};
    const num = {
      calories: numOrNull(calories, true),
      protein: numOrNull(protein),
      fat: numOrNull(fat),
      carbs: numOrNull(carbs),
      weight_grams: numOrNull(weight_grams)
    };
    if (Object.values(num).some((v) => Number.isNaN(v))) {
      return res.status(400).json({ error: "bad_number" });
    }
    const { rows } = await db.query(
      `UPDATE scans SET
         dish_name = COALESCE($3, dish_name),
         calories = COALESCE($4, calories),
         protein = COALESCE($5, protein),
         fat = COALESCE($6, fat),
         carbs = COALESCE($7, carbs),
         weight_grams = COALESCE($8, weight_grams),
         meal_type = COALESCE($9, meal_type)
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, req.user.id,
       dish_name ?? null,
       num.calories, num.protein, num.fat, num.carbs, num.weight_grams,
       MEAL_TYPES.includes(meal_type) ? meal_type : null]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    res.json({ scan: rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/scan/:id
router.delete("/:id", auth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "bad_id" });
    const { rowCount } = await db.query(
      "DELETE FROM scans WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
