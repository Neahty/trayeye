// Распознавание подноса: по фото и меню дня определяем, какие блюда на подносе
// и сколько от каждого осталось. Цепочка провайдеров как в Bytwise:
// сначала бесплатный Gemini, при сбое или квоте - платный OpenAI.

const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const CALL_TIMEOUT_MS = Number(process.env.AI_CALL_TIMEOUT_MS || 30000);
const MAX_TOKENS = 800;

// Gemini и OpenAI не отвечают на запросы с российских IP. На РФ-сервере ходим через
// прокси в Лондоне (tinyproxy, доступен только по туннелю): AI_PROXY_URL=http://10.77.88.1:3128.
let proxyAgent = null;
function proxyOptions() {
  const url = process.env.AI_PROXY_URL;
  if (!url) return {};
  if (!proxyAgent || proxyAgent.proxyUrl !== url) {
    proxyAgent = new HttpsProxyAgent(url);
    proxyAgent.proxyUrl = url;
  }
  return { httpsAgent: proxyAgent, proxy: false };
}

function geminiKeys() {
  return [...new Set(
    [...(process.env.GEMINI_API_KEYS || "").split(","), process.env.GEMINI_API_KEY || ""]
      .map((k) => k.trim())
      .filter(Boolean)
  )];
}

function providerChain() {
  const geminiModels = (process.env.GEMINI_VISION_MODELS || "gemini-3.1-flash-lite,gemini-3.5-flash-lite")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const chain = geminiKeys().flatMap((apiKey) =>
    geminiModels.map((model) => ({ name: "gemini", url: GEMINI_URL, apiKey, model }))
  );
  if (process.env.OPENAI_API_KEY) {
    chain.push({
      name: "openai",
      url: OPENAI_URL,
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_VISION_MODEL || "gpt-4.1"
    });
  }
  return chain;
}

function isConfigured() {
  return providerChain().length > 0;
}

function buildPrompt(menu) {
  const list = menu.map((m) => `${m.dish_id}: ${m.name}`).join("\n");
  return `Ты смотришь на фото подноса в школьной столовой ПОСЛЕ еды.
Меню на сегодня (id: название):
${list}

Найди на подносе блюда ТОЛЬКО из этого меню и оцени, какая доля каждой порции осталась несъеденной:
0 - тарелка пустая, 100 - порцию не трогали. Блюда, которых на подносе нет, не указывай.
Ответь строго JSON без пояснений: {"items":[{"dish_id":0,"leftover_pct":0}]}`;
}

function extractJson(text) {
  const cleaned = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

// Ответ модели -> [{ dish_id, leftover_pct }]: только блюда из меню, проценты 0..100, без повторов.
function parseItems(content, menu) {
  const allowed = new Set(menu.map((m) => m.dish_id));
  const parsed = extractJson(content);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const id = Number(it?.dish_id);
    const raw = it?.leftover_pct;
    // null, "" и false не значат «съедено всё» - такую оценку отбрасываем.
    const pct = typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "") ? Number(raw) : NaN;
    if (!allowed.has(id) || seen.has(id) || !Number.isFinite(pct)) continue;
    seen.add(id);
    out.push({ dish_id: id, leftover_pct: Math.min(100, Math.max(0, Math.round(pct))) });
  }
  return out;
}

// images: [{ buffer, mime }] - в одном запросе может быть несколько подносов.
async function callProvider(provider, prompt, images, maxTokens = MAX_TOKENS, timeout = CALL_TIMEOUT_MS) {
  const { data } = await axios.post(
    provider.url,
    {
      model: provider.model,
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mime};base64,${img.buffer.toString("base64")}` }
          }))
        ]
      }]
    },
    {
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      timeout,
      ...proxyOptions()
    }
  );
  return data.choices?.[0]?.message?.content || "";
}

function notConfigured() {
  const err = new Error("ai_not_configured");
  err.status = 503;
  return err;
}

function allFailed(failures) {
  console.error("[vision] все провайдеры не справились:", failures.join("; "));
  const err = new Error("ai_failed");
  err.status = 502;
  return err;
}

// Возвращает { items, model }. Бросает ошибку со status 503, если ИИ не настроен,
// и 502, если ни один провайдер не дал разборчивого ответа.
// Google временами отвечает 503 «модель перегружена» сразу на все ключи и модели.
// Тогда ждём и проходим цепочку ещё раз (до 3 заходов). Если хоть один отказ был
// другим (неверный ответ, 400, ключ), повторять бессмысленно.
const RETRY_PASSES = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// attempt(provider) -> результат или null («модель ответила, но пусто»).
async function runChain(attempt) {
  const chain = providerChain();
  if (!chain.length) throw notConfigured();
  const failures = [];
  for (let pass = 1; pass <= RETRY_PASSES; pass += 1) {
    let busyOnly = true;
    for (const provider of chain) {
      try {
        const result = await attempt(provider);
        if (result) return result;
        failures.push(`${provider.model}: пустой ответ`);
        busyOnly = false;
      } catch (err) {
        const status = err.response?.status;
        failures.push(`${provider.model}: ${status || err.message}`);
        if (status !== 503 && status !== 429) busyOnly = false;
      }
    }
    if (!busyOnly || pass === RETRY_PASSES) break;
    await sleep(Number(process.env.AI_RETRY_DELAY_MS ?? 6000) * pass);
  }
  throw allFailed(failures);
}

async function analyzeTray({ buffer, mime, menu }) {
  const prompt = buildPrompt(menu);
  return runChain(async (provider) => {
    const items = parseItems(await callProvider(provider, prompt, [{ buffer, mime }]), menu);
    return items.length ? { items, model: provider.model } : null;
  });
}

// Несколько фото в ОДНОМ запросе: у бесплатного Gemini лимит на число запросов, а не на
// картинки в запросе, поэтому шлём пачкой. На одном фото бывает несколько подносов (повар
// снял ряд на столе): подносы считает сама модель - YOLOE без дообучения их не различает.
// «После еды» в промпте не пишем: с такой подсказкой модель ставила 0% целым порциям.
function buildBatchPrompt(menu, count) {
  const list = menu.map((m) => `${m.dish_id}: ${m.name}`).join("\n");
  return `Ниже ${count} фото из школьной столовой, по порядку: фото 1, фото 2 и так далее.
На каждом фото может быть один или несколько подносов с едой.
Меню на сегодня (id: название):
${list}

Для КАЖДОГО подноса на КАЖДОМ фото найди блюда ТОЛЬКО из этого меню и оцени, сколько осталось от порции:
100 - порцию не трогали (полная тарелка), 50 - съели половину, 0 - посуда пустая.
Смотри на то, что реально лежит в посуде. Блюда, которых на подносе нет, не указывай.
Ответь строго JSON без пояснений:
{"photos":[{"photo":1,"trays":[{"items":[{"dish_id":0,"leftover_pct":0}]}]}]}`;
}

// Ответ на пачку -> массив длиной count: по каждому фото список подносов, у подноса - список блюд.
// Поднос без блюд из меню остаётся пустым списком: модель видит еду, но не из сегодняшнего меню.
// null на месте фото - модель про это фото ничего не сказала.
function parseBatch(content, menu, count) {
  const parsed = extractJson(content);
  const photos = Array.isArray(parsed?.photos) ? parsed.photos : [];
  const out = Array.from({ length: count }, () => null);
  photos.forEach((p, i) => {
    const n = Number.isInteger(Number(p?.photo)) ? Number(p.photo) - 1 : i;
    if (n < 0 || n >= count || out[n] || !Array.isArray(p?.trays)) return;
    out[n] = p.trays.map((t) => parseItems(JSON.stringify({ items: t?.items }), menu));
  });
  return out;
}

// images: [{ buffer, mime }] -> { results: [[[{ dish_id, leftover_pct }]] | null], model }:
// по каждому фото - подносы, у каждого подноса - блюда.
async function analyzeTrays({ images, menu }) {
  const prompt = buildBatchPrompt(menu, images.length);
  // На фото бывает 5-6 подносов по 5 блюд: запас токенов на каждое фото.
  const maxTokens = 400 + 600 * images.length;
  // Пачка думает дольше одиночного фото: 6 подносов у gemini flash-lite через прокси - ~27 с.
  const timeout = Math.max(CALL_TIMEOUT_MS, 20000 + 8000 * images.length);
  return runChain(async (provider) => {
    const results = parseBatch(await callProvider(provider, prompt, images, maxTokens, timeout), menu, images.length);
    return results.some((r) => r && r.length) ? { results, model: provider.model } : null;
  });
}

module.exports = { analyzeTray, analyzeTrays, parseItems, parseBatch, buildPrompt, buildBatchPrompt, isConfigured };
