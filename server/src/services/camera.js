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

const visionUrl = () => process.env.CAMERA_VISION_URL || "http://127.0.0.1:4110";
const VIDEO_TIMEOUT_MS = 6 * 60 * 1000;
// Пометка в tray_scans.ai_model: поднос разобран локально, без запроса к ИИ.
const LOCAL_MODEL = "yoloe-local";

function inboxDir() {
  return path.join(UPLOADS_ROOT, "camera-inbox");
}

// Разбор видео локальной моделью. Бросает 503, если сервис камеры не запущен.
async function analyzeVideo(filePath) {
  try {
    const { data } = await axios.post(`${visionUrl()}/video`, { path: filePath, fps: 3 }, { timeout: VIDEO_TIMEOUT_MS });
    return data;
  } catch (err) {
    const e = new Error(err.code === "ECONNREFUSED" ? "camera_unavailable" : "camera_failed");
    e.status = err.code === "ECONNREFUSED" ? 503 : 502;
    throw e;
  }
}

// Одно фото (повар в боте) -> подносы на нём. null - сервис камеры недоступен:
// тогда фото целиком считаем одним подносом и отдаём ИИ.
async function analyzeImage(buffer) {
  try {
    const { data } = await axios.post(`${visionUrl()}/image`, buffer, {
      headers: { "Content-Type": "image/jpeg" }, timeout: 60000, maxBodyLength: 20 * 1024 * 1024
    });
    return data.trays;
  } catch (err) {
    console.error("[camera] фото не разобрано локально:", err.code || err.response?.status || err.message);
    return null;
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

// Пачки уходят одновременно: число запросов то же, а ждать одну пачку (~1 мин у flash-lite),
// а не все по очереди. Больше трёх сразу не шлём, чтобы не упереться в лимит в минуту.
const AI_PARALLEL = 3;

// Что ИИ сказал по каждому кадру с остатками: { trays: [[блюда подноса]], model } или { error }.
async function askAi(shots, menu) {
  const answers = new Map();
  const pending = shots.map((t, i) => i).filter((i) => !shots[i].is_empty);
  const batch = aiBatchSize();
  const chunks = [];
  for (let k = 0; k < pending.length; k += batch) chunks.push(pending.slice(k, k + batch));

  const ask = async (chunk) => {
    try {
      const images = chunk.map((i) => ({ buffer: Buffer.from(shots[i].crop_jpeg, "base64"), mime: "image/jpeg" }));
      const { results, model } = await vision.analyzeTrays({ images, menu });
      chunk.forEach((i, j) => answers.set(i, results[j] ? { trays: results[j], model } : { error: "ai_failed" }));
    } catch (err) {
      chunk.forEach((i) => answers.set(i, { error: err.message }));
    }
  };
  for (let k = 0; k < chunks.length; k += AI_PARALLEL) {
    await Promise.all(chunks.slice(k, k + AI_PARALLEL).map(ask));
  }
  return { answers, requests: chunks.length };
}

async function insertScan({ schoolId, date, photoPath, source, model, items }) {
  return db.withTx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tray_scans (school_id, scan_date, photo_path, source, ai_model)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [schoolId, date, photoPath, source, model]
    );
    for (const it of items) {
      await client.query(
        "INSERT INTO tray_items (scan_id, dish_id, leftover_pct) VALUES ($1, $2, $3)",
        [rows[0].id, it.dish_id, it.leftover_pct]
      );
    }
    return rows[0].id;
  });
}

// Кадры (поднос из видео или фото повара) -> tray_scans/tray_items. menu - блюда дня [{ dish_id, name }].
// На кадре может оказаться несколько подносов: каждый записывается отдельно.
// Итог по кадру: { is_empty, gpt, local, trays: [{ scan_id, items }] } + error или no_menu_dishes.
// source: 'camera' - видео с ленты, 'upload' - фото, присланное человеком.
async function recordTrays({ schoolId, date, menu, trays: shots, source = "camera" }) {
  const names = new Map(menu.map((m) => [m.dish_id, m.name]));
  const named = (items) => items.map((it) => ({ ...it, name: names.get(it.dish_id) }));
  const { answers, requests } = await askAi(shots, menu);
  const results = [];
  for (const [i, shot] of shots.entries()) {
    const base = { is_empty: shot.is_empty, gpt: !shot.is_empty, local: shot.items };
    let found;
    let model;
    if (shot.is_empty) {
      // Школьный обед - комплекс: на подносе блюда дня. Модель видит пустые тарелки -
      // значит, всё съедено, и спрашивать ИИ незачем.
      found = [menu.map((m) => ({ dish_id: m.dish_id, leftover_pct: 0 }))];
      model = LOCAL_MODEL;
    } else {
      const answer = answers.get(i);
      if (answer.error) {
        results.push({ ...base, error: answer.error, trays: [] });
        continue;
      }
      found = answer.trays.filter((items) => items.length);
      model = answer.model;
      // Еда есть, но не из сегодняшнего меню: записывать нечего, говорим об этом прямо.
      if (!found.length) {
        results.push({ ...base, no_menu_dishes: true, trays: [] });
        continue;
      }
    }

    const photoPath = await savePhoto(schoolId, Buffer.from(shot.crop_jpeg, "base64"));
    const saved = [];
    for (const items of found) {
      saved.push({ scan_id: await insertScan({ schoolId, date, photoPath, source, model, items }), items: named(items) });
    }
    results.push({ ...base, trays: saved });
  }
  return { trays: results, aiRequests: requests };
}

module.exports = { analyzeVideo, analyzeImage, recordTrays, inboxDir, LOCAL_MODEL };
