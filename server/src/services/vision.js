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
async function analyzeTray({ buffer, mime, menu }) {
  const chain = providerChain();
  if (!chain.length) throw notConfigured();
  const prompt = buildPrompt(menu);
  const failures = [];
  for (const provider of chain) {
    try {
      const items = parseItems(await callProvider(provider, prompt, [{ buffer, mime }]), menu);
      if (items.length) return { items, model: provider.model };
      failures.push(`${provider.model}: пустой ответ`);
    } catch (err) {
      failures.push(`${provider.model}: ${err.response?.status || err.message}`);
    }
  }
  throw allFailed(failures);
}

// Несколько подносов в ОДНОМ запросе: у бесплатного Gemini лимит на число запросов,
// а не на картинки в запросе, поэтому камера шлёт подносы пачкой.
function buildBatchPrompt(menu, count) {
  const list = menu.map((m) => `${m.dish_id}: ${m.name}`).join("\n");
  return `Ниже ${count} фото подносов из школьной столовой ПОСЛЕ еды, по порядку: поднос 1, поднос 2 и так далее.
Меню на сегодня (id: название):
${list}

Для КАЖДОГО подноса найди блюда ТОЛЬКО из этого меню и оцени, какая доля каждой порции осталась несъеденной:
0 - тарелка пустая, 100 - порцию не трогали. Блюда, которых на подносе нет, не указывай.
Ответь строго JSON без пояснений, по одному элементу на каждый поднос:
{"trays":[{"tray":1,"items":[{"dish_id":0,"leftover_pct":0}]}]}`;
}

// Ответ на пачку -> массив длиной count: по каждому подносу список блюд (пустой, если модель промолчала).
function parseBatch(content, menu, count) {
  const parsed = extractJson(content);
  const trays = Array.isArray(parsed?.trays) ? parsed.trays : [];
  const out = Array.from({ length: count }, () => []);
  trays.forEach((t, i) => {
    const n = Number.isInteger(Number(t?.tray)) ? Number(t.tray) - 1 : i;
    if (n < 0 || n >= count || out[n].length) return;
    out[n] = parseItems(JSON.stringify({ items: t?.items }), menu);
  });
  return out;
}

// images: [{ buffer, mime }] -> { results: [[{ dish_id, leftover_pct }]], model }.
// Подносы, по которым модель ничего не ответила, остаются пустыми списками - их решает вызывающий.
async function analyzeTrays({ images, menu }) {
  const chain = providerChain();
  if (!chain.length) throw notConfigured();
  const prompt = buildBatchPrompt(menu, images.length);
  const maxTokens = 300 + 150 * images.length;
  // Пачка думает дольше одиночного фото: 6 подносов у gemini flash-lite через прокси - ~27 с.
  const timeout = Math.max(CALL_TIMEOUT_MS, 20000 + 8000 * images.length);
  const failures = [];
  for (const provider of chain) {
    try {
      const results = parseBatch(await callProvider(provider, prompt, images, maxTokens, timeout), menu, images.length);
      if (results.some((r) => r.length)) return { results, model: provider.model };
      failures.push(`${provider.model}: пустой ответ`);
    } catch (err) {
      failures.push(`${provider.model}: ${err.response?.status || err.message}`);
    }
  }
  throw allFailed(failures);
}

module.exports = { analyzeTray, analyzeTrays, parseItems, parseBatch, buildPrompt, buildBatchPrompt, isConfigured };
