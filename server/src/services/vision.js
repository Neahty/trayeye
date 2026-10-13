// Распознавание подноса: по фото и меню дня определяем, какие блюда на подносе
// и сколько от каждого осталось. Цепочка провайдеров как в Bytwise:
// сначала бесплатный Gemini, при сбое или квоте - платный OpenAI.

const axios = require("axios");

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const CALL_TIMEOUT_MS = Number(process.env.AI_CALL_TIMEOUT_MS || 30000);
const MAX_TOKENS = 800;

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
    const pct = Number(it?.leftover_pct);
    if (!allowed.has(id) || seen.has(id) || !Number.isFinite(pct)) continue;
    seen.add(id);
    out.push({ dish_id: id, leftover_pct: Math.min(100, Math.max(0, Math.round(pct))) });
  }
  return out;
}

async function callProvider(provider, prompt, imageBase64, mime) {
  const { data } = await axios.post(
    provider.url,
    {
      model: provider.model,
      temperature: 0.1,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mime};base64,${imageBase64}` } }
        ]
      }]
    },
    {
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      timeout: CALL_TIMEOUT_MS
    }
  );
  return data.choices?.[0]?.message?.content || "";
}

// Возвращает { items, model }. Бросает ошибку со status 503, если ИИ не настроен,
// и 502, если ни один провайдер не дал разборчивого ответа.
async function analyzeTray({ buffer, mime, menu }) {
  const chain = providerChain();
  if (!chain.length) {
    const err = new Error("ai_not_configured");
    err.status = 503;
    throw err;
  }
  const prompt = buildPrompt(menu);
  const image = buffer.toString("base64");
  const failures = [];
  for (const provider of chain) {
    try {
      const items = parseItems(await callProvider(provider, prompt, image, mime), menu);
      if (items.length) return { items, model: provider.model };
      failures.push(`${provider.model}: пустой ответ`);
    } catch (err) {
      failures.push(`${provider.model}: ${err.response?.status || err.message}`);
    }
  }
  console.error("[vision] все провайдеры не справились:", failures.join("; "));
  const err = new Error("ai_failed");
  err.status = 502;
  throw err;
}

module.exports = { analyzeTray, parseItems, buildPrompt, isConfigured };
