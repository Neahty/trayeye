// Курс доллара к рублю с сайта ЦБ РФ (бесплатный JSON), с кэшем на 6 часов.
const axios = require("axios");

const CBR_URL = "https://www.cbr-xml-daily.ru/daily_json.js";
const TTL_MS = 6 * 60 * 60 * 1000;
const FALLBACK = Number(process.env.USD_RUB_FALLBACK) || 100;

let cache = { rate: null, at: 0 };

async function getUsdRub() {
  const now = Date.now();
  if (cache.rate && now - cache.at < TTL_MS) return cache.rate;
  try {
    const { data } = await axios.get(CBR_URL, { timeout: 8000 });
    const rate = Number(data?.Valute?.USD?.Value);
    if (Number.isFinite(rate) && rate > 0) {
      cache = { rate, at: now };
      return rate;
    }
  } catch (err) {
    console.error("[fx] CBR fetch failed:", err.message);
  }
  // если не удалось — отдаём прошлый кэш или запасное значение
  return cache.rate || FALLBACK;
}

module.exports = { getUsdRub };
