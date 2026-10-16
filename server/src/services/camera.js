// Камера над лентой: видео -> trayeye-vision (YOLOE на сервере, без токенов) -> подносы.
// Пустой поднос записываем сразу, в ИИ (services/vision.js: Gemini, потом OpenAI) уходят
// только подносы с остатками, и то пачкой в одном запросе: лимит запросов почти не тратится.

const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const vision = require("./vision");
const { UPLOADS_ROOT } = require("../config");

const VISION_URL = process.env.CAMERA_VISION_URL || "http://127.0.0.1:4110";
const VIDEO_TIMEOUT_MS = 6 * 60 * 1000;
// Пометка в tray_scans.ai_model: поднос разобран локально, без запроса к ИИ.
const LOCAL_MODEL = "yoloe-local";

function inboxDir() {
  return path.join(UPLOADS_ROOT, "camera-inbox");
}

// Разбор видео локальной моделью. Бросает 503, если сервис камеры не запущен.
async function analyzeVideo(filePath) {
  try {
    const { data } = await axios.post(`${VISION_URL}/video`, { path: filePath, fps: 3 }, { timeout: VIDEO_TIMEOUT_MS });
    return data;
  } catch (err) {
    const e = new Error(err.code === "ECONNREFUSED" ? "camera_unavailable" : "camera_failed");
    e.status = err.code === "ECONNREFUSED" ? 503 : 502;
    throw e;
  }
}

async function savePhoto(schoolId, buffer) {
  const dir = path.join(UPLOADS_ROOT, "trays", String(schoolId));
  await fs.promises.mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.jpg`;
  await fs.promises.writeFile(path.join(dir, filename), buffer);
  return `trays/${schoolId}/${filename}`;
}

// Сколько подносов отправлять в ИИ одним запросом. Gemini считает запросы, а не картинки,
// поэтому 8 подносов в одном запросе - в 8 раз меньше расход лимита.
function aiBatchSize() {
  return Math.min(16, Math.max(1, Number(process.env.CAMERA_AI_BATCH) || 8));
}

// Что ИИ сказал по каждому подносу с остатками: { items, model } или { error }.
async function askAi(trays, menu) {
  const answers = new Map();
  const pending = trays.map((t, i) => i).filter((i) => !trays[i].is_empty);
  const batch = aiBatchSize();
  let requests = 0;
  for (let k = 0; k < pending.length; k += batch) {
    const chunk = pending.slice(k, k + batch);
    requests += 1;
    try {
      const images = chunk.map((i) => ({ buffer: Buffer.from(trays[i].crop_jpeg, "base64"), mime: "image/jpeg" }));
      const { results, model } = await vision.analyzeTrays({ images, menu });
      chunk.forEach((i, j) => answers.set(i, results[j].length ? { items: results[j], model } : { error: "ai_failed" }));
    } catch (err) {
      chunk.forEach((i) => answers.set(i, { error: err.message }));
    }
  }
  return { answers, requests };
}

// Подносы из видео -> tray_scans/tray_items. menu - блюда дня [{ dish_id, name }].
// Возвращает итог по каждому подносу и число запросов к ИИ; сбой ИИ не роняет остальные подносы.
async function recordTrays({ schoolId, date, menu, trays }) {
  const names = new Map(menu.map((m) => [m.dish_id, m.name]));
  const { answers, requests } = await askAi(trays, menu);
  const results = [];
  for (const [i, tray] of trays.entries()) {
    const buffer = Buffer.from(tray.crop_jpeg, "base64");
    let items;
    let model;
    if (tray.is_empty) {
      // Школьный обед - комплекс: на подносе блюда дня. Модель видит пустые тарелки -
      // значит, всё съедено, и спрашивать ИИ незачем.
      items = menu.map((m) => ({ dish_id: m.dish_id, leftover_pct: 0 }));
      model = LOCAL_MODEL;
    } else {
      const answer = answers.get(i);
      if (answer.error) {
        results.push({ is_empty: false, gpt: true, error: answer.error, local: tray.items });
        continue;
      }
      ({ items, model } = answer);
    }

    const photoPath = await savePhoto(schoolId, buffer);
    const scanId = await db.withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO tray_scans (school_id, scan_date, photo_path, source, ai_model)
         VALUES ($1, $2, $3, 'camera', $4) RETURNING id`,
        [schoolId, date, photoPath, model]
      );
      for (const it of items) {
        await client.query(
          "INSERT INTO tray_items (scan_id, dish_id, leftover_pct) VALUES ($1, $2, $3)",
          [rows[0].id, it.dish_id, it.leftover_pct]
        );
      }
      return rows[0].id;
    });
    results.push({
      scan_id: scanId,
      is_empty: tray.is_empty,
      gpt: !tray.is_empty,
      local: tray.items,
      items: items.map((it) => ({ ...it, name: names.get(it.dish_id) }))
    });
  }
  return { trays: results, aiRequests: requests };
}

module.exports = { analyzeVideo, recordTrays, inboxDir, LOCAL_MODEL };
