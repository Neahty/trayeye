// Реальные расходы организации OpenAI через Costs API.
// Нужен Admin-ключ (OPENAI_ADMIN_KEY, формат sk-admin-...). Обычный sk-proj не подходит.
// Документация: GET https://api.openai.com/v1/organization/costs
const axios = require("axios");

const ADMIN_KEY = process.env.OPENAI_ADMIN_KEY || "";
const TTL_MS = 60 * 60 * 1000; // кэш на 1 час — чтобы не дёргать API на каждый заход в админку

let cache = { data: null, at: 0 };

function hasKey() {
  return ADMIN_KEY.startsWith("sk-admin-");
}

// Возвращает { total_usd, today_usd, by_day:[{day:'YYYY-MM-DD', cost}] } или null, если ключа нет / ошибка.
async function getCosts(days = 30) {
  if (!hasKey()) return null;
  const now = Date.now();
  if (cache.data && now - cache.at < TTL_MS) return cache.data;

  try {
    const startTime = Math.floor((now - days * 86400000) / 1000);
    const { data } = await axios.get("https://api.openai.com/v1/organization/costs", {
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      params: { start_time: startTime, bucket_width: "1d", limit: Math.min(days + 1, 180) },
      timeout: 15000
    });

    const buckets = Array.isArray(data?.data) ? data.data : [];
    const todayStr = new Date().toISOString().slice(0, 10);
    let total = 0;
    let today = 0;
    const byDay = [];
    for (const b of buckets) {
      const day = new Date((b.start_time || 0) * 1000).toISOString().slice(0, 10);
      let cost = 0;
      for (const r of b.results || []) cost += Number(r?.amount?.value) || 0;
      total += cost;
      if (day === todayStr) today += cost;
      byDay.push({ day, cost: Math.round(cost * 1e4) / 1e4 });
    }

    const result = {
      total_usd: Math.round(total * 1e4) / 1e4,
      today_usd: Math.round(today * 1e4) / 1e4,
      by_day: byDay
    };
    cache = { data: result, at: now };
    return result;
  } catch (err) {
    console.error("[openaiCosts] fetch failed:", err.response?.status, err.message);
    return cache.data || null;
  }
}

// Сколько долларов потрачено с момента startMs до сейчас (для остатка баланса в админке).
// Возвращает число USD или null, если admin-ключа нет / запрос не удался. Кэш на 1 час по дню старта.
let sinceCache = { key: null, usd: null, at: 0 };
async function getSpentUsdSince(startMs) {
  if (!hasKey()) return null;
  const now = Date.now();
  const key = String(Math.floor(startMs / 86400000)); // округляем старт до дня — граница бакетов
  if (sinceCache.usd != null && sinceCache.key === key && now - sinceCache.at < TTL_MS) return sinceCache.usd;

  try {
    const startTime = Math.floor(startMs / 1000);
    const days = Math.ceil((now - startMs) / 86400000) + 1;
    const { data } = await axios.get("https://api.openai.com/v1/organization/costs", {
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      params: { start_time: startTime, bucket_width: "1d", limit: Math.min(Math.max(days, 1), 180) },
      timeout: 15000
    });
    const buckets = Array.isArray(data?.data) ? data.data : [];
    let total = 0;
    for (const b of buckets) for (const r of b.results || []) total += Number(r?.amount?.value) || 0;
    total = Math.round(total * 1e4) / 1e4;
    sinceCache = { key, usd: total, at: now };
    return total;
  } catch (err) {
    console.error("[openaiCosts] since fetch failed:", err.response?.status, err.message);
    return sinceCache.key === key ? sinceCache.usd : null;
  }
}

module.exports = { getCosts, getSpentUsdSince, hasKey };
