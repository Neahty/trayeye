const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const { createPayment, getPayment, isMock } = require("../services/yukassa");
const { getActiveSubscription } = require("../utils/subscription");
const { ensureRefCode } = require("../utils/refcode");
const settings = require("../utils/settings");
const notify = require("../services/notify");
const channelLog = require("../services/channelLog");
const employeeReferrals = require("../services/employeeReferrals");

const router = express.Router();

// Находит тариф по id среди настроенных в админке. Возвращает { price, duration_days, enabled, title }.
// Fallback на sub_price_basic / 30 дней, если тарифов нет (старые БД).
async function getTariff(type) {
  const list = await settings.get("tariffs");
  const t = Array.isArray(list) ? list.find((x) => x && x.id === type) : null;
  if (t) {
    const price = Number(t.price);
    const days = Number(t.duration_days);
    return {
      price: Number.isFinite(price) && price > 0 ? price : 349,
      duration_days: Number.isFinite(days) && days > 0 ? days : 30,
      enabled: t.enabled !== false,
      title: t.title || "Bytwise PRO"
    };
  }
  // Тарифа в списке нет — берём базовую цену из настроек.
  const fallback = Number(await settings.get(type === "trainer" ? "sub_price_trainer" : "sub_price_basic"));
  return {
    price: Number.isFinite(fallback) && fallback > 0 ? fallback : type === "trainer" ? 1799 : 349,
    duration_days: 30,
    enabled: type === "basic",
    title: "Bytwise PRO"
  };
}
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

// Применяет успешную оплату: подписка + payment — АТОМАРНО.
// Идемпотентна по yukassaId: повтор вебхука/двойной вызов не создаёт дубликатов
// (dup-проверка + частичный UNIQUE на payments(yukassa_id) WHERE succeeded → 23505).
// Все записи в одной транзакции; сетевые побочки (ensureRefCode/notify) — после COMMIT.
// Возвращает true если оплата применена, false если уже была обработана.
async function fulfillPayment({ userId, type, amount, yukassaId, durationDays = 30 }) {
  let applied;
  let isRenewal = false;
  try {
    applied = await db.withTx(async (c) => {
      // Идемпотентность: уже обработанный платёж — выходим без побочных эффектов.
      if (yukassaId) {
        const dup = await c.query(
          "SELECT 1 FROM payments WHERE yukassa_id = $1 AND status = 'succeeded' LIMIT 1",
          [yukassaId]
        );
        if (dup.rows.length) return false;
      }

      // Была ли у пользователя подписка раньше — значит это продление, а не первая покупка.
      const prior = await c.query("SELECT 1 FROM subscriptions WHERE user_id = $1 LIMIT 1", [userId]);
      isRenewal = prior.rows.length > 0;

      // Гасим прежние активные подписки, чтобы у пользователя не копилось несколько active-строк.
      await c.query(
        "UPDATE subscriptions SET status='cancelled', auto_renew=FALSE WHERE user_id=$1 AND status='active'",
        [userId]
      );

      const now = new Date();
      const days = Number(durationDays) > 0 ? Number(durationDays) : 30;
      const expires = new Date(now.getTime() + days * 86400000);

      await c.query(
        `INSERT INTO subscriptions (user_id, type, status, started_at, expires_at, yukassa_id, auto_renew, method)
         VALUES ($1,$2,'active',$3,$4,$5,TRUE,'yukassa')`,
        [userId, type, now, expires, yukassaId]
      );

      // Платёж: переводим существующий pending-заказ (из buy) в succeeded; если его нет
      // (mock/прямой вызов) — вставляем новую строку. Частичный UNIQUE ловит гонку (23505).
      const upd = yukassaId
        ? await c.query(
            `UPDATE payments SET status='succeeded', amount=$2, method='yukassa', sub_type=$3
              WHERE yukassa_id=$1 AND status='pending' RETURNING id`,
            [yukassaId, amount, type]
          )
        : { rows: [] };
      if (!upd.rows.length) {
        await c.query(
          `INSERT INTO payments (user_id, amount, status, yukassa_id, method, sub_type)
           VALUES ($1,$2,'succeeded',$3,'yukassa',$4)`,
          [userId, amount, yukassaId, type]
        );
      }

      await c.query(
        `INSERT INTO system_logs (user_id, action, details) VALUES ($1,'payment',$2)`,
        [userId, JSON.stringify({ type, amount, yukassaId })]
      );
      return true;
    });
  } catch (err) {
    // Гонка: параллельный вебхук успел зафиксировать succeeded-платёж первым.
    if (err.code === "23505") return false;
    throw err;
  }

  if (!applied) return false;

  // Побочные эффекты ВНЕ транзакции (сеть/Telegram) — после успешного COMMIT, чтобы не держать
  // транзакцию открытой на медленных вызовах и чтобы вебхук отвечал быстро (меньше повторов ЮKassa).
  // Тренерская подписка даёт реф-ссылку — гарантируем, что у тренера есть ref_code.
  if (type === "trainer") {
    ensureRefCode(userId).catch((e) => console.error("[refcode] trainer:", e.message));
  }
  // Уведомления: пользователю — успех, админам — о покупке. Сбой не ломает оплату.
  notify.notifyPurchase(userId, { amount, type, renewal: isRenewal }).catch((e) => console.error("[notify] purchase:", e.message));
  // Атрибуция оплаты сотруднику-пиарщику, если покупатель — чей-то реферал.
  // Идемпотентно (UNIQUE payment_id); пропущенное при падении процесса доловит ежечасный крон.
  // Окно 2 дня: created_at платежа — момент СОЗДАНИЯ заказа (buy), вебхук может прийти позже.
  employeeReferrals.attributePaymentsSince("2 days").catch((e) => console.error("[empRef] attribute:", e.message));
  return true;
}

// POST /api/subscription/buy  { type }
router.post("/buy", auth, async (req, res, next) => {
  try {
    // Тип тарифа приходит из приложения; по умолчанию — basic.
    const type = req.body?.type || "basic";
    const tariff = await getTariff(type);

    // Тариф выключен в админке — купить нельзя.
    if (!tariff.enabled) {
      return res.status(400).json({ error: "tariff_disabled" });
    }

    // Нельзя купить повторно, пока активна текущая подписка.
    // Исключение — апгрейд basic → trainer: разрешён за полную цену; при оплате
    // fulfillPayment погасит basic и запустит тренерскую с нуля на её срок.
    // Даунгрейд trainer → basic и повторная покупка того же тарифа — нельзя.
    const active = await getActiveSubscription(req.user.id);
    if (active && !(active.type === "basic" && type === "trainer")) {
      return res.status(409).json({ error: "already_subscribed", expires_at: active.expires_at });
    }

    const amount = tariff.price;
    const durationDays = tariff.duration_days;

    // Mock-режим (нет ключей ЮKassa): сразу активируем подписку без внешнего редиректа,
    // иначе на телефоне переход на SERVER_URL срывается и подписка не создаётся.
    if (isMock()) {
      await fulfillPayment({
        userId: req.user.id,
        type,
        amount,
        yukassaId: "mock_" + Date.now(),
        durationDays
      });
      return res.json({ activated: true, mock: true, amount });
    }

    // Защита от дублей заказов: если по этой же подписке уже есть незавершённый заказ
    // моложе 10 минут (пока жива ссылка ЮKassa) — отдаём ту же ссылку, а не плодим новый.
    // Для другой подписки (другой sub_type) фильтр не сработает — создастся новый заказ.
    const recent = await db.query(
      `SELECT yukassa_id, confirmation_url FROM payments
        WHERE user_id = $1 AND sub_type = $2 AND status = 'pending'
          AND confirmation_url IS NOT NULL
          AND created_at > NOW() - INTERVAL '10 minutes'
        ORDER BY created_at DESC LIMIT 1`,
      [req.user.id, type]
    );
    if (recent.rows[0]) {
      const prev = recent.rows[0];
      // Перепроверяем в ЮKassa, что заказ ещё ждёт оплаты (не отменён/не оплачен).
      const verified = await getPayment(prev.yukassa_id);
      if (verified && verified.status === "pending") {
        return res.json({ payment_url: prev.confirmation_url, mock: false, amount, reused: true });
      }
      // Заказ уже не платёжеспособен — закрываем висящий pending, создадим новый ниже.
      if (verified && verified.status !== "pending") {
        await db.query("UPDATE payments SET status='cancelled' WHERE yukassa_id=$1 AND status='pending'", [prev.yukassa_id]);
      }
    }

    const payment = await createPayment({
      amount,
      description: `Bytwise ${tariff.title}`,
      metadata: { user_id: req.user.id, type, amount, duration_days: durationDays }
    });

    await db.query(
      `INSERT INTO payments (user_id, amount, status, yukassa_id, method, sub_type, confirmation_url)
       VALUES ($1,$2,'pending',$3,'yukassa',$4,$5)`,
      [req.user.id, amount, payment.payment_id, type, payment.payment_url]
    );

    // Лог «начал оплату» — человек получил ссылку на ЮKassa (воронка оплаты).
    (async () => {
      const who = await notify.userLabel(req.user.id);
      channelLog.post(
        "payment_started",
        `🛒 <b>Начал оплату</b>\n\n` +
        `${who} открыл окно оплаты.\n` +
        `Тариф: <b>${channelLog.esc(tariff.title)}</b>\n` +
        `Сумма: ${amount} ₽\n` +
        `Время: ${notify.fmtWhen()}`
      ).catch(() => {});
    })().catch(() => {});

    res.json({ payment_url: payment.payment_url, mock: payment.mock, amount });
  } catch (err) {
    next(err);
  }
});

// GET /api/subscription/mock-confirm  (только mock-режим)
router.get("/mock-confirm", async (req, res, next) => {
  try {
    // Роут активирует подписку без авторизации — допустим только в mock-режиме.
    if (!isMock()) return res.status(404).send("not_found");

    let meta;
    try {
      meta = JSON.parse(req.query.meta || "{}");
    } catch {
      return res.status(400).send("bad meta"); // кривой JSON в ?meta= → 400, а не падение в 500
    }
    if (!meta.user_id) return res.status(400).send("bad meta");

    // fulfillPayment идемпотентна по yukassaId.
    await fulfillPayment({
      userId: meta.user_id,
      type: meta.type,
      amount: meta.amount,
      yukassaId: req.query.payment_id,
      durationDays: meta.duration_days || 30
    });
    res.redirect(`${CLIENT_URL}/?paid=1`);
  } catch (err) {
    next(err);
  }
});

// POST /api/subscription/webhook  (ЮКасса)
router.post("/webhook", async (req, res, next) => {
  try {
    const event = req.body?.event;
    const obj = req.body?.object;

    if (event === "payment.succeeded" && obj?.metadata?.user_id && obj?.id) {
      // Защита от подделки: перепроверяем платёж напрямую в ЮKassa.
      // Поддельный/чужой id там не подтвердится статусом succeeded.
      const verified = await getPayment(obj.id);
      if (!verified || verified.status !== "succeeded") {
        return res.json({ ok: true }); // не подтверждён — игнорируем, без побочных эффектов
      }
      const meta = verified.metadata || obj.metadata;
      await fulfillPayment({
        userId: meta.user_id,
        type: meta.type,
        amount: Number(verified.amount?.value) || Number(obj.amount?.value) || meta.amount,
        yukassaId: obj.id,
        durationDays: Number(meta.duration_days) || 30
      });
    } else if (event === "payment.canceled" && obj?.id) {
      // Платёж отменён (не оплачен/отклонён) — обновляем висящий pending, не трогаем succeeded.
      const upd = await db.query(
        "UPDATE payments SET status='cancelled' WHERE yukassa_id=$1 AND status='pending' RETURNING user_id, amount, sub_type, created_at",
        [obj.id]
      );
      if (upd.rows[0]) {
        const p = upd.rows[0];
        try { await notify.notifyPaymentFailed(p.user_id, { amount: p.amount, type: p.sub_type, when: p.created_at }); }
        catch (e) { console.error("[notify] canceled:", e.message); }
      }
    } else if (event === "refund.succeeded" && obj?.payment_id) {
      // Возврат прошёл — помечаем исходный платёж как возвращённый.
      const upd = await db.query(
        "UPDATE payments SET status='refunded' WHERE yukassa_id=$1 AND status='succeeded' RETURNING user_id, amount, sub_type",
        [obj.payment_id]
      );
      if (upd.rows[0]) {
        const p = upd.rows[0];
        try { await notify.notifyRefund(p.user_id, { amount: p.amount, type: p.sub_type }); }
        catch (e) { console.error("[notify] refund:", e.message); }
      }
    }

    // ЮKassa требует всегда отвечать 200, иначе будет повторять уведомление.
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/subscription/status
router.get("/status", auth, async (req, res, next) => {
  try {
    const sub = await getActiveSubscription(req.user.id);
    res.json({ subscription: sub || null });
  } catch (err) {
    next(err);
  }
});

// GET /api/subscription/payments — история платежей пользователя (экран «Управление подпиской»)
router.get("/payments", auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, amount, status, method, sub_type, created_at
       FROM payments WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ payments: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/subscription/cancel
router.post("/cancel", auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `UPDATE subscriptions SET auto_renew = FALSE
        WHERE user_id = $1 AND status = 'active' AND auto_renew = TRUE
        RETURNING id`,
      [req.user.id]
    );
    // Логируем отмену только если автопродление реально было включено (одно событие).
    if (rows.length) {
      (async () => {
        const who = await notify.userLabel(req.user.id);
        channelLog.post(
          "autorenew_cancel",
          `🔕 <b>Отключил автопродление</b>\n\n` +
          `${who} отключил автопродление подписки.\n` +
          `Время: ${notify.fmtWhen()}`
        ).catch(() => {});
      })().catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.fulfillPayment = fulfillPayment;
