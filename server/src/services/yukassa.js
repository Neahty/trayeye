const axios = require("axios");
const crypto = require("crypto");

const SHOP_ID = process.env.YUKASSA_SHOP_ID || "";
const SECRET_KEY = process.env.YUKASSA_SECRET_KEY || "";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

// mock-режим, если явно задан или нет ключей
function isMock() {
  return process.env.PAYMENTS_MODE === "mock" || !SHOP_ID || !SECRET_KEY;
}

// Создаёт платёж. Возвращает { payment_id, payment_url, mock }
// idempotenceKey - опционален: передайте стабильный ключ, чтобы безопасно повторять
// один и тот же логический запрос (ЮKassa вернёт исходный результат в течение 24ч).
async function createPayment({ amount, description, metadata, idempotenceKey }) {
  if (isMock()) {
    const paymentId = "mock_" + crypto.randomBytes(8).toString("hex");
    const base = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 4000}`;
    return {
      payment_id: paymentId,
      payment_url: `${base}/api/subscription/mock-confirm?payment_id=${paymentId}&meta=${encodeURIComponent(JSON.stringify(metadata))}`,
      mock: true
    };
  }

  const idemKey = idempotenceKey || crypto.randomUUID();
  // save_payment_method (сохранение карты для автопродления) требует подключённых
  // рекуррентных платежей у магазина - иначе ЮKassa отвечает 403 forbidden
  // («This store can't make recurring payments»). По умолчанию выключено: обычный
  // разовый платёж. Включить можно env YUKASSA_RECURRING=true, когда ЮKassa подключит автоплатежи.
  const savePaymentMethod = process.env.YUKASSA_RECURRING === "true";
  const { data } = await axios.post(
    "https://api.yookassa.ru/v3/payments",
    {
      amount: { value: amount.toFixed(2), currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: CLIENT_URL },
      description,
      metadata,
      save_payment_method: savePaymentMethod
    },
    {
      auth: { username: SHOP_ID, password: SECRET_KEY },
      headers: { "Idempotence-Key": idemKey },
      timeout: 20000
    }
  );

  return {
    payment_id: data.id,
    payment_url: data.confirmation?.confirmation_url,
    mock: false
  };
}

// Перепроверка платежа напрямую в ЮKassa (защита вебхука от подделки).
// Возвращает объект платежа ЮKassa ({ id, status, amount, metadata, ... }) или null.
async function getPayment(id) {
  if (!id || isMock()) return null;
  try {
    const { data } = await axios.get(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(id)}`, {
      auth: { username: SHOP_ID, password: SECRET_KEY },
      timeout: 20000
    });
    return data;
  } catch (err) {
    console.error("[yukassa] getPayment failed:", err.response?.data || err.message);
    return null;
  }
}

// --- Учёт денег по API ЮKassa (для админки) ---

// Простой in-memory кэш, чтобы не дёргать API на каждом заходе в админку.
const _cache = new Map(); // key -> { at, data }
const CACHE_TTL = 120_000; // 2 минуты

function _cacheGet(key) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
  return null;
}
function _cacheSet(key, data) {
  _cache.set(key, { at: Date.now(), data });
  return data;
}

// Универсальная постраничная выборка списка (payments | refunds) с суммированием.
// from/to - ISO-строки. cb(item, acc) накапливает суммы в acc.
async function _paginate(resource, { from, to }, acc, reduce) {
  let cursor = null;
  let pages = 0;
  do {
    const params = {
      "created_at.gte": from,
      "created_at.lte": to,
      status: "succeeded",
      limit: 100
    };
    if (cursor) params.cursor = cursor;
    const { data } = await axios.get(`https://api.yookassa.ru/v3/${resource}`, {
      auth: { username: SHOP_ID, password: SECRET_KEY },
      params,
      timeout: 25000
    });
    for (const item of data.items || []) reduce(item, acc);
    cursor = data.next_cursor || null;
    pages += 1;
  } while (cursor && pages < 50); // потолок 50 страниц (5000 записей)
  return acc;
}

// Сумма поступлений за период: { gross, net, commission, count }.
// gross - брутто (amount), net - чистыми (income_amount, после комиссии ЮKassa).
async function listPaymentsSummary({ from, to }) {
  if (isMock()) return { mock: true };
  const key = `pay:${from}:${to}`;
  const cached = _cacheGet(key);
  if (cached) return cached;

  const acc = await _paginate("payments", { from, to }, { gross: 0, net: 0, count: 0 }, (p, a) => {
    const gross = Number(p.amount?.value) || 0;
    const net = p.income_amount?.value != null ? Number(p.income_amount.value) : gross;
    a.gross += gross;
    a.net += net;
    a.count += 1;
  });
  acc.commission = Math.max(acc.gross - acc.net, 0);
  return _cacheSet(key, acc);
}

// Сумма возвратов за период: { refunds, count }.
async function listRefundsSummary({ from, to }) {
  if (isMock()) return { mock: true };
  const key = `ref:${from}:${to}`;
  const cached = _cacheGet(key);
  if (cached) return cached;

  const acc = await _paginate("refunds", { from, to }, { refunds: 0, count: 0 }, (r, a) => {
    a.refunds += Number(r.amount?.value) || 0;
    a.count += 1;
  });
  return _cacheSet(key, acc);
}

module.exports = { createPayment, getPayment, isMock, listPaymentsSummary, listRefundsSummary };
