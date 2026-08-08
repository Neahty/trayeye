// Реальные расходы организации OpenAI через Costs API.
// Нужен Admin-ключ (OPENAI_ADMIN_KEY, формат sk-admin-...). Обычный sk-proj не подходит.
// Документация: GET https://api.openai.com/v1/organization/costs
//
// Важное свойство источника: бакеты — СУТКИ ПО UTC, и текущие сутки OpenAI отдаёт
// с задержкой (в течение дня там ноль, даже когда запросы уже прошли). Поэтому Costs API
// годится для «сколько потрачено за period», но НЕ для карточки «потрачено сегодня» —
// её админка считает оценкой по токенам, см. routes/admin.js.
const axios = require("axios");

const ADMIN_KEY = process.env.OPENAI_ADMIN_KEY || "";
const TTL_MS = 60 * 60 * 1000; // кэш на 1 час — чтобы не дёргать API на каждый заход в админку
const MAX_BUCKETS = 180;       // потолок limit в Costs API

let cache = new Map(); // days -> { data, at }

function hasKey() {
  return ADMIN_KEY.startsWith("sk-admin-");
}

// Один запрос к Costs API. Возвращает массив [{ day:'YYYY-MM-DD', cost }] по возрастанию дня.
async function fetchBuckets(startMs, days) {
  const { data } = await axios.get("https://api.openai.com/v1/organization/costs", {
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
    params: {
      start_time: Math.floor(startMs / 1000),
      bucket_width: "1d",
      limit: Math.min(Math.max(days, 1), MAX_BUCKETS)
    },
    timeout: 15000
  });
  const buckets = Array.isArray(data?.data) ? data.data : [];
  return buckets.map((b) => {
    let cost = 0;
    for (const r of b.results || []) cost += Number(r?.amount?.value) || 0;
    return { day: new Date((b.start_time || 0) * 1000).toISOString().slice(0, 10), cost: Math.round(cost * 1e4) / 1e4 };
  });
}

// Возвращает { total_usd, by_day:[{day, cost}] } за последние `days` суток
// или null, если ключа нет / запрос не удался.
async function getCosts(days = 30) {
  if (!hasKey()) return null;
  const key = Math.min(Math.max(Math.ceil(days), 1), MAX_BUCKETS);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.data;

  try {
    const byDay = await fetchBuckets(now - key * 86400000, key + 1);
    const total = byDay.reduce((a, r) => a + r.cost, 0);
    const result = { total_usd: Math.round(total * 1e4) / 1e4, by_day: byDay };
    cache.set(key, { data: result, at: now });
    return result;
  } catch (err) {
    console.error("[openaiCosts] fetch failed:", err.response?.status, err.message);
    return hit?.data || null;
  }
}

// Сколько долларов потрачено с момента startMs до сейчас (для остатка баланса в админке).
// firstDayShare — какая доля расходов первых суток пришлась на время ПОСЛЕ startMs.
// Бакеты суточные, поэтому без этой поправки в расход попадало всё, что потрачено
// в день ввода баланса ДО самого ввода. Долю считает вызывающий код по своим токенам.
// Возвращает число USD или null, если admin-ключа нет / запрос не удался.
let sinceCache = { key: null, usd: null, at: 0 };
async function getSpentUsdSince(startMs, firstDayShare = 1) {
  if (!hasKey()) return null;
  const now = Date.now();
  const share = Math.min(Math.max(Number(firstDayShare) || 0, 0), 1);
  const key = `${Math.floor(startMs / 86400000)}:${share.toFixed(2)}`;
  if (sinceCache.usd != null && sinceCache.key === key && now - sinceCache.at < TTL_MS) return sinceCache.usd;

  try {
    const days = Math.ceil((now - startMs) / 86400000) + 1;
    const byDay = await fetchBuckets(startMs, days);
    const startDay = new Date(startMs).toISOString().slice(0, 10);
    let total = 0;
    for (const r of byDay) total += r.day === startDay ? r.cost * share : r.cost;
    total = Math.round(total * 1e4) / 1e4;
    sinceCache = { key, usd: total, at: now };
    return total;
  } catch (err) {
    console.error("[openaiCosts] since fetch failed:", err.response?.status, err.message);
    return sinceCache.key === key ? sinceCache.usd : null;
  }
}

module.exports = { getCosts, getSpentUsdSince, hasKey };
