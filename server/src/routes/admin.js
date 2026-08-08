const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const adminAuth = require("../middleware/adminAuth");
const settings = require("../utils/settings");
const broadcast = require("../services/broadcast");
const { getUsdRub } = require("../services/fx");
const openaiCosts = require("../services/openaiCosts");
const { parseId } = require("../utils/http");
const { listPaymentsSummary, listRefundsSummary } = require("../services/yukassa");
const supportBot = require("../services/supportBot");
const channelLog = require("../services/channelLog");
const moderation = require("../services/moderation");
const { subscriptionReminders, sendTestReminder } = require("../jobs/subscriptionReminders");
const { sendTestMealReminder } = require("../jobs/notifications");

const router = express.Router();
router.use(adminAuth);

// Цена тарифа из настроек (как в routes/subscription.js) — для ручной записи платежа.
async function getTariffPrice(type) {
  const key = type === "trainer" ? "sub_price_trainer" : "sub_price_basic";
  const val = Number(await settings.get(key));
  return Number.isFinite(val) && val > 0 ? val : type === "trainer" ? 1799 : 349;
}

// Название тарифа из настроек (динамически) — для понятных сообщений в канал-логах.
async function tariffTitleAdmin(type) {
  try {
    const list = await settings.get("tariffs");
    const t = Array.isArray(list) ? list.find((x) => x && x.id === type) : null;
    if (t?.title) return t.title;
  } catch { /* настроек нет — отдаём дефолт */ }
  return type === "trainer" ? "Тренерская" : "PRO";
}

// Опционально записывает «ручной» платёж в выручку при выдаче подписки админом.
// Вызывается, когда деньги фактически пришли мимо кассы и админ хочет учесть их.
async function recordManualPayment(userId, type, amount) {
  const value = Number.isFinite(Number(amount)) && Number(amount) > 0
    ? Math.round(Number(amount))
    : await getTariffPrice(type);
  await db.query(
    `INSERT INTO payments (user_id, amount, status, yukassa_id, method, sub_type)
     VALUES ($1,$2,'succeeded',$3,'manual',$4)`,
    [userId, value, "manual_" + Date.now(), type]
  );
  return value;
}

const UPLOADS_ROOT = path.resolve(__dirname, "../../../uploads");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ============================ ДАШБОРД ============================
router.get("/dashboard", async (req, res, next) => {
  try {
    const q = (text, params) => db.query(text, params).then((r) => r.rows);

    // Все независимые запросы дашборда выполняем параллельно (было ~13 последовательных)
    const [
      [totals], [newToday], [dau], [mau], [activeSubs], [paidUsers],
      [revToday], [revMonth], [scansToday], [inactive],
      userGrowth, revenueGrowth, activity, scansChart
    ] = await Promise.all([
      // Универсум пользователей = открывавшие приложение (app_opened). Среди них:
      // АКТИВНЫЕ = подписчик канала и бот не в ЧС (channel_member AND NOT tg_unreachable);
      // НЕАКТИВНЫЕ = отписался от канала ИЛИ заблокировал бота (см. ниже). Данные неактивных
      // НЕ удаляются — только статус. В канале есть читатели новостей: они не взаимодействовали
      // с ботом, поэтому не в users и не в счёте вовсе.
      q("SELECT COUNT(*)::int AS c FROM users WHERE app_opened = TRUE AND channel_member = TRUE AND tg_unreachable = FALSE"),
      // Новые активные за сегодня — по дате подписки на канал.
      q("SELECT COUNT(*)::int AS c FROM users WHERE app_opened = TRUE AND channel_member = TRUE AND tg_unreachable = FALSE AND (channel_joined_at AT TIME ZONE 'Asia/Yekaterinburg')::date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date"),
      q("SELECT COUNT(DISTINCT user_id)::int AS c FROM system_logs WHERE action='login' AND created_at >= NOW() - interval '1 day'"),
      q("SELECT COUNT(DISTINCT user_id)::int AS c FROM system_logs WHERE action='login' AND created_at >= NOW() - interval '30 days'"),
      q("SELECT COUNT(DISTINCT user_id)::int AS c FROM subscriptions WHERE status='active' AND expires_at > NOW()"),
      q("SELECT COUNT(DISTINCT user_id)::int AS c FROM payments WHERE status='succeeded'"),
      q("SELECT COALESCE(SUM(amount),0)::int AS s FROM payments WHERE status='succeeded' AND (created_at AT TIME ZONE 'Asia/Yekaterinburg')::date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date"),
      q("SELECT COALESCE(SUM(amount),0)::int AS s FROM payments WHERE status='succeeded' AND created_at >= date_trunc('month', NOW())"),
      q("SELECT COUNT(*)::int AS c FROM scans WHERE (scanned_at AT TIME ZONE 'Asia/Yekaterinburg')::date = (NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date"),
      // НЕАКТИВНЫЕ: открывали приложение, но сейчас не подписчики ИЛИ заблокировали бота.
      q("SELECT COUNT(*)::int AS c FROM users WHERE app_opened = TRUE AND (channel_member = FALSE OR tg_unreachable = TRUE)"),
      // Группировку по дню считаем в том же поясе (Asia/Yekaterinburg), что и сводные карточки выше,
      // иначе столбик «сегодня» на графике расходился с числом на карточке.
      q(`SELECT (created_at AT TIME ZONE 'Asia/Yekaterinburg')::date AS day, COUNT(*)::int AS count FROM users
         WHERE created_at >= NOW() - interval '30 days' GROUP BY day ORDER BY day ASC`),
      q(`SELECT (created_at AT TIME ZONE 'Asia/Yekaterinburg')::date AS day, COALESCE(SUM(amount),0)::int AS amount FROM payments
         WHERE status='succeeded' AND created_at >= NOW() - interval '30 days' GROUP BY day ORDER BY day ASC`),
      q(`SELECT (created_at AT TIME ZONE 'Asia/Yekaterinburg')::date AS day, COUNT(DISTINCT user_id)::int AS users FROM system_logs
         WHERE action='login' AND created_at >= NOW() - interval '30 days' GROUP BY day ORDER BY day ASC`),
      q(`SELECT (scanned_at AT TIME ZONE 'Asia/Yekaterinburg')::date AS day, COUNT(*)::int AS count FROM scans
         WHERE scanned_at >= NOW() - interval '30 days' GROUP BY day ORDER BY day ASC`)
    ]);

    const conversion = totals.c ? Math.round((paidUsers.c / totals.c) * 1000) / 10 : 0;

    // Остаток баланса OpenAI в рублях: баланс (введён вручную) минус расход с момента ввода.
    // Расход берём из Costs API (реальные деньги), иначе — оценка по ai_usage. Курс — ЦБ РФ.
    let gptBalanceRub = null, gptBalanceIsReal = false, gptBalanceUpdatedAt = null;
    const balanceUsd = Number(await settings.get("openai_balance_usd")) || 0;
    if (balanceUsd > 0) {
      const balanceAt = await settings.get("openai_balance_at");
      gptBalanceUpdatedAt = balanceAt || null;
      const sinceMs = balanceAt ? new Date(balanceAt).getTime() : Date.now();
      const [rate, realSpent] = await Promise.all([getUsdRub(), openaiCosts.getSpentUsdSince(sinceMs)]);
      let spentUsd = realSpent;
      if (spentUsd == null) {
        const [row] = await q("SELECT COALESCE(SUM(cost_usd),0) AS c FROM ai_usage WHERE created_at >= $1", [new Date(sinceMs)]);
        spentUsd = Number(row.c) || 0;
      } else {
        gptBalanceIsReal = true;
      }
      gptBalanceRub = Math.round(Math.max(0, balanceUsd - spentUsd) * rate);
    }

    res.json({
      gpt_balance_rub: gptBalanceRub,             // остаток в рублях (null → карточка скрыта)
      gpt_balance_is_real: gptBalanceIsReal,      // true = расход из OpenAI, false = оценка по токенам
      gpt_balance_updated_at: gptBalanceUpdatedAt,
      total_users: totals.c,        // активные (подписчик + не в ЧС) — основной счёт
      active_users: totals.c,
      inactive_users: inactive.c,   // отписались/в ЧС, но данные сохранены
      new_today: newToday.c,
      dau: dau.c,
      mau: mau.c,
      conversion_percent: conversion,
      active_subscribers: activeSubs.c,
      revenue_today: revToday.s,
      revenue_month: revMonth.s,
      scans_today: scansToday.c,
      charts: { user_growth: userGrowth, revenue_growth: revenueGrowth, activity, scans: scansChart }
    });
  } catch (err) {
    next(err);
  }
});

// ============================ ПОЛЬЗОВАТЕЛИ ============================
router.get("/users", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;

    const where = [];
    const params = [];
    if (search) {
      params.push(search);
      where.push(`(CAST(u.telegram_id AS TEXT) ILIKE $${params.length} OR u.username ILIKE $${params.length} OR u.name ILIKE $${params.length})`);
    }
    if (req.query.blocked === "true") where.push("u.is_blocked = TRUE");
    if (req.query.subscribed === "true") where.push("EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=u.id AND s.status='active' AND s.expires_at>NOW())");
    // Активный = открывал приложение, подписан на канал, бот не в ЧС. Неактивный — обратное.
    if (req.query.active === "true") where.push("u.app_opened = TRUE AND u.channel_member = TRUE AND u.tg_unreachable = FALSE");
    if (req.query.active === "false") where.push("u.app_opened = TRUE AND (u.channel_member = FALSE OR u.tg_unreachable = TRUE)");

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Конец пробного периода считаем как в checkLimit.js: trial_started_at + trial_days.
    const trialDays = Number(await settings.get("trial_days")) || 3;

    const listParams = [...params, trialDays, limit, offset];
    const { rows } = await db.query(
      `SELECT u.id, u.telegram_id, u.username, u.name, u.is_admin, u.is_blocked, u.blocked_at,
              u.created_at, u.last_login_at, u.app_opened, u.channel_member, u.tg_unreachable,
              (SELECT type FROM subscriptions s WHERE s.user_id=u.id AND s.status='active' AND s.expires_at>NOW() ORDER BY expires_at DESC LIMIT 1) AS sub_type,
              (SELECT expires_at FROM subscriptions s WHERE s.user_id=u.id AND s.status='active' AND s.expires_at>NOW() ORDER BY expires_at DESC LIMIT 1) AS sub_expires_at,
              (SELECT expires_at FROM subscriptions s WHERE s.user_id=u.id ORDER BY expires_at DESC LIMIT 1) AS last_sub_expires_at,
              (COALESCE(u.trial_started_at, u.created_at) + make_interval(days => $${listParams.length - 2})) AS trial_ends_at,
              (SELECT COUNT(*)::int FROM scans sc WHERE sc.user_id=u.id) AS scans_count
       FROM users u ${whereSql}
       ORDER BY u.created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    const count = await db.query(`SELECT COUNT(*)::int AS c FROM users u ${whereSql}`, params);
    res.json({ users: rows, total: count.rows[0].c, page, limit });
  } catch (err) {
    next(err);
  }
});

// Полная карточка пользователя
router.get("/users/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "bad_id" });
    const { rows: urows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    const user = urows[0];
    if (!user) return res.status(404).json({ error: "not_found" });

    const sub = await db.query(
      "SELECT * FROM subscriptions WHERE user_id=$1 ORDER BY started_at DESC LIMIT 1",
      [id]
    );
    const activity = await db.query(
      `SELECT COUNT(*) FILTER (WHERE action='login')::int AS logins,
              MAX(created_at) FILTER (WHERE action='login') AS last_login
       FROM system_logs WHERE user_id=$1`,
      [id]
    );
    const nutrition = await db.query(
      `SELECT COUNT(*)::int AS scans,
              COUNT(DISTINCT (scanned_at AT TIME ZONE 'Asia/Yekaterinburg')::date)::int AS days,
              COALESCE(SUM(calories),0)::int AS total_cal,
              COALESCE(AVG(protein),0) AS avg_protein,
              COALESCE(AVG(fat),0) AS avg_fat,
              COALESCE(AVG(carbs),0) AS avg_carbs
       FROM scans WHERE user_id=$1`,
      [id]
    );
    const ai = await db.query(
      `SELECT COUNT(*)::int AS requests, COALESCE(SUM(total_tokens),0)::int AS tokens,
              COALESCE(SUM(cost_usd),0) AS cost
       FROM ai_usage WHERE user_id=$1`,
      [id]
    );
    const payments = await db.query(
      "SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
      [id]
    );
    // Откуда человек пришёл: по личной ссылке друга, по ссылке сотрудника-пиарщика
    // или сам. Механики независимы, но у одного юзера может быть только одна строка
    // в каждой таблице, поэтому проверяем обе и отдаём первую найденную.
    const fromFriend = await db.query(
      `SELECT i.status, i.reject_reason, i.created_at,
              u.id, u.name, u.username, u.telegram_id
         FROM user_invites i JOIN users u ON u.id = i.inviter_id
        WHERE i.user_id = $1`,
      [id]
    );
    const fromEmployee = fromFriend.rows.length ? { rows: [] } : await db.query(
      `SELECT r.status, r.reject_reason, r.created_at,
              u.id, u.name, u.username, u.telegram_id
         FROM employee_referrals r
         JOIN employees e ON e.id = r.employee_id
         JOIN users u ON u.id = e.user_id
        WHERE r.user_id = $1`,
      [id]
    );
    // Сколько привёл сам — чтобы победителя конкурса было видно прямо в карточке.
    const invitesSent = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COUNT(*)::int AS total
         FROM user_invites WHERE inviter_id = $1`,
      [id]
    );

    const inviteRow = fromFriend.rows[0] || fromEmployee.rows[0] || null;
    const inviteSource = inviteRow
      ? {
        kind: fromFriend.rows.length ? "user" : "employee",
        status: inviteRow.status,
        reject_reason: inviteRow.reject_reason,
        created_at: inviteRow.created_at,
        inviter: {
          id: inviteRow.id,
          name: inviteRow.name,
          username: inviteRow.username,
          telegram_id: inviteRow.telegram_id
        }
      }
      : null;

    const n = nutrition.rows[0];
    const avgDayCal = n.days ? Math.round(n.total_cal / n.days) : 0;

    // Конец пробного периода — как в checkLimit.js (trial_started_at + trial_days).
    const trialDays = Number(await settings.get("trial_days")) || 3;
    const trialStart = new Date(user.trial_started_at || user.created_at);
    const trialEndsAt = new Date(trialStart.getTime() + trialDays * 24 * 60 * 60 * 1000);

    res.json({
      user,
      subscription: sub.rows[0] || null,
      trial_ends_at: trialEndsAt,
      activity: {
        logins: activity.rows[0].logins,
        last_login: activity.rows[0].last_login,
        device: user.device
      },
      nutrition: {
        scans: n.scans,
        avg_day_calories: avgDayCal,
        avg_protein: Math.round(Number(n.avg_protein) * 10) / 10,
        avg_fat: Math.round(Number(n.avg_fat) * 10) / 10,
        avg_carbs: Math.round(Number(n.avg_carbs) * 10) / 10
      },
      ai: {
        requests: ai.rows[0].requests,
        tokens: ai.rows[0].tokens,
        cost_usd: Math.round(Number(ai.rows[0].cost) * 1e4) / 1e4
      },
      payments: payments.rows,
      invite_source: inviteSource,
      invites_sent: invitesSent.rows[0]
    });
  } catch (err) {
    next(err);
  }
});

// Выдать/продлить подписку  { type, days|expires_at }
router.patch("/users/:id/subscription", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "bad_id" });
    const type = req.body?.type === "trainer" ? "trainer" : "basic";
    let expires;
    if (req.body?.expires_at) expires = new Date(req.body.expires_at);
    else expires = new Date(Date.now() + (Number(req.body?.days) || 30) * 86400000);
    // Гасим прежние активные, чтобы у пользователя не копилось несколько active-строк.
    await db.query(
      "UPDATE subscriptions SET status='cancelled', auto_renew=FALSE WHERE user_id=$1 AND status='active'",
      [id]
    );
    await db.query(
      `INSERT INTO subscriptions (user_id, type, status, started_at, expires_at, auto_renew, method)
       VALUES ($1,$2,'active',NOW(),$3,FALSE,'manual')`,
      [id, type, expires]
    );
    // Деньги в выручку добавляем только если админ явно подтвердил (record_payment=true):
    // например, оплата прошла мимо кассы и её нужно учесть. По умолчанию — без денег.
    let recordedAmount = null;
    if (req.body?.record_payment) {
      recordedAmount = await recordManualPayment(id, type, req.body?.amount);
    }
    await db.logAction(req.admin.id, "admin_action", {
      action: "grant_subscription", target: id, type,
      recorded_payment: Boolean(req.body?.record_payment), amount: recordedAmount
    });
    // Дублируем ручную выдачу подписки в Telegram-канал (как платёжное событие).
    try {
      const u = (await db.query("SELECT name, username FROM users WHERE id=$1", [id])).rows[0];
      const who = u ? (u.username ? `@${channelLog.esc(u.username)}` : channelLog.esc(u.name || `#${id}`)) : `#${id}`;
      const title = channelLog.esc(await tariffTitleAdmin(type));
      const days = req.body?.expires_at ? null : (Number(req.body?.days) || 30);
      channelLog.post("payments",
        `🛠 <b>Подписка выдана вручную (админ)</b>\n\n` +
        `Клиент: ${who}\n` +
        `Подписка: <b>${title}</b>\n` +
        (days ? `Срок: ${days} дн.\n` : `Действует до: ${expires.toLocaleDateString("ru-RU")}\n`) +
        (recordedAmount != null ? `Учтена оплата: ${recordedAmount} ₽` : `Без денег (бесплатно)`)
      ).catch(() => {});
    } catch { /* канал не критичен */ }
    res.json({ ok: true, recorded_amount: recordedAmount });
  } catch (err) {
    next(err);
  }
});

// Забрать подписку (отменить активные)
router.delete("/users/:id/subscription", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "bad_id" });
    await db.query(
      "UPDATE subscriptions SET status='cancelled', auto_renew=FALSE WHERE user_id=$1 AND status='active'",
      [id]
    );
    await db.logAction(req.admin.id, "admin_action", { action: "revoke_subscription", target: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Аккаунт админа нельзя удалять — защита от удаления самих себя и друг друга.
// Для банов такая же проверка живёт в services/moderation.js (isProtected): тем же
// кодом банят команды «.запретить»/«.разрешить» из канала логов, правило одно на оба пути.
async function isAdminUser(id) {
  const { rows } = await db.query("SELECT is_admin FROM users WHERE id = $1", [id]);
  return rows.length > 0 && rows[0].is_admin === true;
}

router.patch("/users/:id/block", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "bad_id" });
    if (id === req.admin.id) return res.status(400).json({ error: "cannot_block_self" });
    if (await moderation.isProtected(id)) return res.status(403).json({ error: "cannot_block_admin" });
    await moderation.blockUser(id, { byTelegramId: req.admin.telegram_id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.patch("/users/:id/unblock", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "bad_id" });
    await moderation.unblockUser(id, { byTelegramId: req.admin.telegram_id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Выдача тренерской подписки идёт через общий роут PATCH /users/:id/subscription
// (type:"trainer" + выбранный срок). Отдельный роут /users/:id/trainer удалён за ненадобностью.

// Удалить аккаунт (каскадно)
router.delete("/users/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "bad_id" });
    if (id === req.admin.id) return res.status(400).json({ error: "cannot_delete_self" });
    if (await isAdminUser(id)) return res.status(403).json({ error: "cannot_delete_admin" });
    // Каскадное удаление — в одной транзакции, иначе сбой посередине оставит осиротевшие данные.
    await db.withTx(async (c) => {
      await c.query("DELETE FROM broadcast_clicks WHERE user_id=$1", [id]);
      await c.query("DELETE FROM user_achievements WHERE user_id=$1", [id]);
      await c.query("DELETE FROM ai_usage WHERE user_id=$1", [id]);
      await c.query("DELETE FROM weight_history WHERE user_id=$1", [id]);
      await c.query("DELETE FROM scans WHERE user_id=$1", [id]);
      await c.query("DELETE FROM payments WHERE user_id=$1", [id]);
      await c.query("DELETE FROM subscriptions WHERE user_id=$1", [id]);
      await c.query("DELETE FROM referrals WHERE referrer_id=$1 OR referred_id=$1", [id]);
      await c.query("DELETE FROM referral_balance WHERE user_id=$1", [id]);
      await c.query("DELETE FROM trainer_clients WHERE trainer_id=$1 OR client_id=$1", [id]);
      await c.query("DELETE FROM admin_credentials WHERE user_id=$1", [id]);
      await c.query("UPDATE users SET referred_by=NULL WHERE referred_by=$1", [id]);
      await c.query("DELETE FROM system_logs WHERE user_id=$1", [id]);
      await c.query("DELETE FROM users WHERE id=$1", [id]);
    });
    await db.logAction(req.admin.id, "admin_action", { action: "delete_user", target: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ============================ ПОДПИСКИ ============================
router.get("/subscriptions", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT s.*, u.telegram_id, u.username, u.name,
              (SELECT method FROM payments p WHERE p.user_id=s.user_id AND p.status='succeeded' ORDER BY created_at DESC LIMIT 1) AS pay_method
       FROM subscriptions s JOIN users u ON u.id=s.user_id
       ORDER BY s.started_at DESC NULLS LAST LIMIT 300`
    );
    res.json({ subscriptions: rows });
  } catch (err) { next(err); }
});

router.get("/users/:id/payments", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "bad_id" });
    const { rows } = await db.query(
      "SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC",
      [id]
    );
    res.json({ payments: rows });
  } catch (err) { next(err); }
});

// ============================ ФИНАНСЫ ============================
router.get("/finance", async (req, res, next) => {
  try {
    const q = (t, p) => db.query(t, p).then((r) => r.rows);
    const [total] = await q("SELECT COALESCE(SUM(amount),0)::int AS s FROM payments WHERE status='succeeded'");
    const [day] = await q("SELECT COALESCE(SUM(amount),0)::int AS s FROM payments WHERE status='succeeded' AND (created_at AT TIME ZONE 'Asia/Yekaterinburg')::date=(NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date");
    const [week] = await q("SELECT COALESCE(SUM(amount),0)::int AS s FROM payments WHERE status='succeeded' AND created_at >= NOW() - interval '7 days'");
    const [month] = await q("SELECT COALESCE(SUM(amount),0)::int AS s FROM payments WHERE status='succeeded' AND created_at >= date_trunc('month', NOW())");
    const byDay = await q(
      `SELECT (created_at AT TIME ZONE 'Asia/Yekaterinburg')::date AS day, COALESCE(SUM(amount),0)::int AS amount FROM payments
       WHERE status='succeeded' AND created_at >= NOW() - interval '30 days' GROUP BY day ORDER BY day ASC`
    );
    const byTariff = await q(
      `SELECT COALESCE(sub_type,'basic') AS tariff, COALESCE(SUM(amount),0)::int AS amount, COUNT(*)::int AS count
       FROM payments WHERE status='succeeded' GROUP BY tariff`
    );
    res.json({
      total: total.s, day: day.s, week: week.s, month: month.s,
      by_day: byDay, by_tariff: byTariff
    });
  } catch (err) { next(err); }
});

// Деньги по данным API ЮKassa: получено / комиссия / чистыми / возвраты.
// period = day | week | month | all. «Выведено на счёт» через API недоступно — только в ЛК ЮKassa.
router.get("/finance/yukassa", async (req, res, next) => {
  try {
    const period = ["day", "week", "month", "all"].includes(req.query.period) ? req.query.period : "month";
    const to = new Date();
    to.setSeconds(0, 0); // округляем до минуты, чтобы кэш в yukassa.js реально срабатывал
    const from = new Date(to);
    if (period === "day") from.setDate(from.getDate() - 1);
    else if (period === "week") from.setDate(from.getDate() - 7);
    else if (period === "month") from.setMonth(from.getMonth() - 1);
    else from.setFullYear(from.getFullYear() - 2); // all: безопасный потолок ~2 года

    const range = { from: from.toISOString(), to: to.toISOString() };
    const [pay, ref] = await Promise.all([
      listPaymentsSummary(range),
      listRefundsSummary(range)
    ]);

    if (pay?.mock || ref?.mock) {
      return res.json({ mock: true, period });
    }

    // Округляем согласованно, чтобы на экране всегда выполнялось получено = комиссия + чистыми.
    const gross = Math.round(pay.gross);
    const net = Math.round(pay.net);
    res.json({
      mock: false,
      period,
      gross,
      net,
      commission: gross - net,
      count: pay.count,
      refunds: Math.round(ref.refunds),
      refunds_count: ref.count
    });
  } catch (err) { next(err); }
});

// Платежи: фильтр по статусу (all|succeeded|refunded|error|pending|cancelled)
router.get("/payments", async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    if (req.query.status && req.query.status !== "all") {
      params.push(req.query.status);
      where.push(`p.status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await db.query(
      `SELECT p.*, u.telegram_id, u.username FROM payments p JOIN users u ON u.id=p.user_id
       ${whereSql} ORDER BY p.created_at DESC LIMIT 300`,
      params
    );
    res.json({ payments: rows });
  } catch (err) { next(err); }
});

// ============================ AI-АНАЛИТИКА ============================
router.get("/ai", async (req, res, next) => {
  try {
    const q = (t, p) => db.query(t, p).then((r) => r.rows);
    const [stat] = await q(
      `SELECT COUNT(*)::int AS requests,
              COALESCE(AVG(latency_ms),0)::int AS avg_latency,
              COALESCE(SUM(cost_usd),0) AS total_cost,
              COALESCE(SUM(total_tokens),0)::int AS total_tokens,
              COUNT(*) FILTER (WHERE status='error')::int AS errors
       FROM ai_usage`
    );
    const [today] = await q(
      "SELECT COALESCE(SUM(cost_usd),0) AS cost, COUNT(*)::int AS requests FROM ai_usage WHERE (created_at AT TIME ZONE 'Asia/Yekaterinburg')::date=(NOW() AT TIME ZONE 'Asia/Yekaterinburg')::date"
    );
    const byDay = await q(
      `SELECT (created_at AT TIME ZONE 'Asia/Yekaterinburg')::date AS day, COUNT(*)::int AS requests,
              COALESCE(SUM(cost_usd),0) AS cost FROM ai_usage
       WHERE created_at >= NOW() - interval '30 days' GROUP BY day ORDER BY day ASC`
    );
    const topUsers = await q(
      `SELECT a.user_id, u.username, u.telegram_id,
              COALESCE(SUM(a.total_tokens),0)::int AS tokens, COALESCE(SUM(a.cost_usd),0) AS cost, COUNT(*)::int AS requests
       FROM ai_usage a JOIN users u ON u.id=a.user_id
       GROUP BY a.user_id, u.username, u.telegram_id
       ORDER BY tokens DESC LIMIT 20`
    );

    // Курс ЦБ РФ + реальные расходы OpenAI (если есть admin-ключ)
    const [rate, real] = await Promise.all([getUsdRub(), openaiCosts.getCosts(30)]);
    const rub = (usd) => Math.round((Number(usd) || 0) * rate);

    // Расходы по дням для графика: реальные (OpenAI) если доступны, иначе оценка по токенам
    const byDayUsd = real?.by_day?.length ? real.by_day : byDay.map((r) => ({ day: r.day, cost: Number(r.cost) || 0 }));
    const chart = byDayUsd.map((r) => ({ day: r.day, cost_rub: rub(r.cost) }));

    const estTotalUsd = Math.round(Number(stat.total_cost) * 1e4) / 1e4;
    const estTodayUsd = Math.round(Number(today.cost) * 1e4) / 1e4;

    res.json({
      requests: stat.requests,
      requests_today: today.requests,
      avg_latency_ms: stat.avg_latency,
      total_tokens: stat.total_tokens,
      errors: stat.errors,

      usd_rub: Math.round(rate * 100) / 100,
      is_real: Boolean(real),                 // true = реальные деньги из OpenAI, false = оценка по токенам
      // Итоговые суммы в рублях (реальные, если есть ключ; иначе оценка)
      spent_total_rub: real ? rub(real.total_usd) : rub(estTotalUsd),
      spent_today_rub: real ? rub(real.today_usd) : rub(estTodayUsd),
      // На всякий случай оценка по токенам отдельно (в рублях)
      estimate_total_rub: rub(estTotalUsd),

      chart, // [{ day, cost_rub }]
      top_users: topUsers.map((r) => ({
        user_id: r.user_id, username: r.username, telegram_id: r.telegram_id,
        requests: r.requests, tokens: r.tokens, cost_rub: rub(r.cost)
      }))
    });
  } catch (err) { next(err); }
});

// ============================ СКАНИРОВАНИЕ ЕДЫ ============================
router.get("/scans", async (req, res, next) => {
  try {
    const q = (t, p) => db.query(t, p).then((r) => r.rows);
    const [counts] = await q(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE source='photo')::int AS photo,
              COUNT(*) FILTER (WHERE source='text')::int AS text,
              COUNT(*) FILTER (WHERE source='manual')::int AS manual
       FROM scans`
    );
    const popular = await q(
      "SELECT dish_name, COUNT(*)::int AS count FROM scans GROUP BY dish_name ORDER BY count DESC LIMIT 15"
    );
    // успех распознавания по ai_usage
    const [aiStat] = await q(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='ok')::int AS ok FROM ai_usage`
    );
    const recognitionRate = aiStat.total ? Math.round((aiStat.ok / aiStat.total) * 1000) / 10 : 0;
    const errors = await q(
      `SELECT * FROM system_logs WHERE action='error' AND details->>'where' IN ('scan','scan_text')
       ORDER BY created_at DESC LIMIT 100`
    );
    // журнал
    const journal = await q(
      `SELECT s.id, s.dish_name, s.calories, s.protein, s.fat, s.carbs, s.source, s.ai_confidence,
              s.photo_path, s.scanned_at, u.telegram_id, u.username
       FROM scans s JOIN users u ON u.id=s.user_id
       ORDER BY s.scanned_at DESC LIMIT 100`
    );
    res.json({
      counts,
      popular,
      recognition_rate: recognitionRate,
      errors,
      journal
    });
  } catch (err) { next(err); }
});

// ============================ УВЕДОМЛЕНИЯ ============================
router.get("/broadcasts", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT b.*, u.username AS admin_username FROM broadcasts b LEFT JOIN users u ON u.id=b.admin_id
       ORDER BY b.created_at DESC LIMIT 100`
    );
    res.json({ broadcasts: rows });
  } catch (err) { next(err); }
});

router.post("/broadcasts", upload.single("photo"), async (req, res, next) => {
  try {
    const AUDIENCES = ["all", "subscribed", "unsubscribed", "new", "expiring", "churned", "sub_basic", "sub_trainer", "inactive", "user"];
    const audience = AUDIENCES.includes(req.body.audience) ? req.body.audience : "all";
    const kind = ["text", "photo", "buttons"].includes(req.body.kind) ? req.body.kind : "text";
    const text = req.body.text || "";
    let buttons = null;
    if (req.body.buttons) {
      // Кривой JSON — явная ошибка, а не молчаливая рассылка без кнопок.
      try { buttons = JSON.parse(req.body.buttons); }
      catch { return res.status(400).json({ error: "bad_buttons_json" }); }
    }
    // Точечная рассылка: список id получателей обязателен.
    let targetUserIds = null;
    if (audience === "user") {
      try { targetUserIds = JSON.parse(req.body.target_user_ids || "[]"); }
      catch { return res.status(400).json({ error: "no_target_users" }); }
      targetUserIds = Array.isArray(targetUserIds)
        ? targetUserIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : [];
      if (!targetUserIds.length) return res.status(400).json({ error: "no_target_users" });
    }
    let photoPath = null;
    if (kind === "photo" && req.file) {
      const dir = path.join(UPLOADS_ROOT, "broadcasts");
      fs.mkdirSync(dir, { recursive: true });
      const ext = (req.file.mimetype.split("/")[1] || "jpg").replace("jpeg", "jpg");
      const filename = `${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(dir, filename), req.file.buffer);
      photoPath = `uploads/broadcasts/${filename}`;
    }
    // Создаём запись и СРАЗУ отвечаем админу, а отправку гоним в фоне — иначе на большой
    // аудитории запрос висел минуты и обрывался по таймауту (админ жал «отправить» повторно → дубль).
    const result = await broadcast.createBroadcast({
      adminId: req.admin.id, audience, kind, text, photoPath, buttons, targetUserIds
    });
    broadcast.runBroadcast(result.id).catch((e) => console.error("[broadcast] run:", e.message));
    res.json({ broadcast: result });
  } catch (err) { next(err); }
});

// ============================ АНАЛИТИКА ПРОДУКТА (воронка) ============================
router.get("/funnel", async (req, res, next) => {
  try {
    const q = (t, p) => db.query(t, p).then((r) => r.rows);
    const [started] = await q("SELECT COUNT(*)::int AS c FROM users");
    const [opened] = await q("SELECT COUNT(*)::int AS c FROM users WHERE app_opened = TRUE");
    const [profileFilled] = await q(
      "SELECT COUNT(*)::int AS c FROM users WHERE gender IS NOT NULL AND age IS NOT NULL AND height IS NOT NULL AND weight IS NOT NULL"
    );
    const [firstScan] = await q("SELECT COUNT(DISTINCT user_id)::int AS c FROM scans");
    // вернулись на след. день: есть login в день регистрации+1
    const [returned] = await q(
      `SELECT COUNT(*)::int AS c FROM (
         SELECT u.id FROM users u
         WHERE EXISTS (
           SELECT 1 FROM system_logs l WHERE l.user_id=u.id AND l.action='login'
             AND (l.created_at AT TIME ZONE 'Asia/Yekaterinburg')::date
               = ((u.created_at AT TIME ZONE 'Asia/Yekaterinburg')::date + interval '1 day')
         )
       ) t`
    );
    const [bought] = await q("SELECT COUNT(DISTINCT user_id)::int AS c FROM payments WHERE status='succeeded'");

    const steps = [
      { key: "started", label: "Нажали /start", value: started.c },
      { key: "opened", label: "Открыли приложение", value: opened.c },
      { key: "profile", label: "Заполнили профиль", value: profileFilled.c },
      { key: "first_scan", label: "Сделали первый скан", value: firstScan.c },
      { key: "returned", label: "Вернулись на след. день", value: returned.c },
      { key: "bought", label: "Купили подписку", value: bought.c }
    ];
    // отток между шагами
    for (let i = 0; i < steps.length; i++) {
      const prev = i === 0 ? steps[0].value : steps[i - 1].value;
      steps[i].conversion = steps[0].value ? Math.round((steps[i].value / steps[0].value) * 1000) / 10 : 0;
      steps[i].drop = i === 0 ? 0 : Math.max(0, prev - steps[i].value);
    }
    res.json({ funnel: steps });
  } catch (err) { next(err); }
});

// ============================ ЛОГИ ============================
router.get("/logs", async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    if (req.query.action) { params.push(req.query.action); where.push(`l.action = $${params.length}`); }
    if (req.query.user_id) { params.push(Number(req.query.user_id)); where.push(`l.user_id = $${params.length}`); }
    if (req.query.from) { params.push(req.query.from); where.push(`l.created_at >= $${params.length}`); }
    if (req.query.to) { params.push(req.query.to); where.push(`l.created_at <= $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows } = await db.query(
      `SELECT l.*, u.username, u.telegram_id FROM system_logs l LEFT JOIN users u ON u.id=l.user_id
       ${whereSql} ORDER BY l.created_at DESC LIMIT 400`,
      params
    );
    res.json({ logs: rows });
  } catch (err) { next(err); }
});

// ============================ НАСТРОЙКИ ============================
router.get("/settings", async (req, res, next) => {
  try {
    const all = await settings.loadAll();
    res.json({ settings: all });
  } catch (err) { next(err); }
});

router.put("/settings", async (req, res, next) => {
  try {
    const updates = req.body?.settings || req.body || {};
    const allowed = [
      "sub_price_basic", "sub_price_trainer", "tariffs", "free_scan_daily_limit",
      "trial_days", "trainer_max_clients", "welcome_text", "paywall_text", "paywall_features",
      "support_links", "reminders", "meal_reminders", "limit_push",
      "tg_log_enabled", "tg_log_channel_id", "tg_log_events", "admin_live_refresh_sec",
      // Вкладка «Ссылки»: глобальные ссылки для Главной.
      "nutritionist_url", "plan_url", "support_url", "reviews_url"
    ];
    for (const key of Object.keys(updates)) {
      if (!allowed.includes(key)) continue;
      await settings.set(key, updates[key], req.admin.id);
    }
    // Баланс OpenAI: сохраняем сумму и, только если она изменилась, обновляем дату ввода —
    // с неё считается расход. Иначе сохранение других вкладок обнуляло бы «потрачено».
    if (Object.prototype.hasOwnProperty.call(updates, "openai_balance_usd")) {
      const newVal = Math.max(0, Number(updates.openai_balance_usd) || 0);
      const prevVal = Number(await settings.get("openai_balance_usd")) || 0;
      await settings.set("openai_balance_usd", newVal, req.admin.id);
      if (newVal !== prevVal) await settings.set("openai_balance_at", new Date().toISOString(), req.admin.id);
    }
    // Зеркалим цену базового тарифа в sub_price_basic — единый источник правды для fallback'ов.
    if (Array.isArray(updates.tariffs)) {
      const basic = updates.tariffs.find((t) => t && t.id === "basic");
      const price = Number(basic?.price);
      if (Number.isFinite(price) && price > 0) await settings.set("sub_price_basic", price, req.admin.id);
    }
    await db.logAction(req.admin.id, "admin_action", { action: "update_settings", keys: Object.keys(updates) });
    const all = await settings.loadAll();
    res.json({ settings: all });
  } catch (err) { next(err); }
});

// ===================== НАПОМИНАНИЯ О ПОДПИСКЕ ======================
// Ручной запуск рассылки (кнопка «Разослать сейчас»): каждому клиенту уходит
// сообщение по его ТЕКУЩЕЙ ситуации (пробный / последний день / пробный кончился /
// подписка истекает / истекла — сколько бы дней ни прошло). Защита: не больше
// одного напоминания в сутки на человека, повторное нажатие в тот же день не дублит.
router.post("/reminders/run", async (req, res, next) => {
  try {
    const stats = await subscriptionReminders({ force: true, blast: true });
    await db.logAction(req.admin.id, "admin_action", { action: "run_subscription_reminders", ...stats });
    if (stats.disabled) return res.json({ ok: false, disabled: true });
    res.json({ ok: true, ...stats });
  } catch (err) { next(err); }
});

// Тестовое напоминание себе (кнопка «Проверить на себе»): пример выбранного типа
// уходит только текущему админу в Telegram.
const REMINDER_KINDS = ["trial_start", "trial_end", "trial_post", "paid_pre", "paid_post", "payment_abandoned"];
router.post("/reminders/test", async (req, res, next) => {
  try {
    const kind = req.body?.kind;
    if (!REMINDER_KINDS.includes(kind)) return res.status(400).json({ error: "bad_kind" });

    const { rows } = await db.query(
      "SELECT id, telegram_id, name, timezone FROM users WHERE id = $1", [req.admin.id]
    );
    if (!rows[0]?.telegram_id) return res.status(404).json({ error: "admin_user_not_found" });

    const result = await sendTestReminder({ kind, user: rows[0] });
    await db.logAction(req.admin.id, "admin_action", { action: "test_subscription_reminder", kind });
    if (result && result.error === "no_templates") return res.json({ ok: false, error: "no_templates" });
    if (result && result.mock) return res.json({ ok: false, error: "mock_mode" });
    if (result && result.ok === false) {
      return res.json({ ok: false, error: result.error_code === 403 ? "bot_not_started" : "send_failed" });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Тестовое напоминание о еде себе (кнопка «Проверить на себе» в разделе «Напоминания о еде»):
// пример выбранного приёма уходит только текущему админу в Telegram (без кнопки оплаты).
const MEAL_KINDS = ["breakfast", "lunch", "dinner"];
router.post("/reminders/meal-test", async (req, res, next) => {
  try {
    const meal = req.body?.meal;
    if (!MEAL_KINDS.includes(meal)) return res.status(400).json({ error: "bad_meal" });

    const { rows } = await db.query(
      "SELECT id, telegram_id, name, timezone, daily_calories FROM users WHERE id = $1", [req.admin.id]
    );
    if (!rows[0]?.telegram_id) return res.status(404).json({ error: "admin_user_not_found" });

    const result = await sendTestMealReminder({ meal, user: rows[0] });
    await db.logAction(req.admin.id, "admin_action", { action: "test_meal_reminder", meal });
    if (result && result.error === "no_templates") return res.json({ ok: false, error: "no_templates" });
    if (result && result.mock) return res.json({ ok: false, error: "mock_mode" });
    if (result && result.ok === false) {
      return res.json({ ok: false, error: result.error_code === 403 ? "bot_not_started" : "send_failed" });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ============================ ПОДДЕРЖКА ============================
// Тикеты создаёт отдельный бот поддержки (папка support/, общая база).
// Здесь — просмотр, ответ и закрытие из веб-админки через SUPPORT_BOT_TOKEN.

// Список тикетов: ?status=open|closed|all (по умолчанию open)
router.get("/support/tickets", async (req, res, next) => {
  try {
    const status = ["open", "closed", "all"].includes(req.query.status) ? req.query.status : "open";
    const limit = Math.min(100, Number(req.query.limit) || 50);
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where = status === "all" ? "" : "WHERE t.status = $3";
    const params = status === "all" ? [limit, offset] : [limit, offset, status];

    const { rows } = await db.query(
      `SELECT t.*,
              u.name AS app_name, u.created_at AS app_registered_at, u.app_opened,
              (SELECT COUNT(*)::int FROM support_messages m WHERE m.ticket_id = t.id) AS message_count,
              (SELECT m.text FROM support_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_text
       FROM support_tickets t
       LEFT JOIN users u ON u.telegram_id = t.user_id
       ${where}
       ORDER BY t.updated_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );
    const totals = await db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'open')::int AS open_count
       FROM support_tickets`
    );
    const total = status === "all"
      ? totals.rows[0].total
      : (await db.query("SELECT COUNT(*)::int AS c FROM support_tickets WHERE status = $1", [status])).rows[0].c;
    res.json({ tickets: rows, total, open_count: totals.rows[0].open_count });
  } catch (err) { next(err); }
});

// Тикет целиком: шапка + вся переписка
router.get("/support/tickets/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });
    const { rows } = await db.query(
      `SELECT t.*, u.name AS app_name, u.created_at AS app_registered_at, u.app_opened
       FROM support_tickets t
       LEFT JOIN users u ON u.telegram_id = t.user_id
       WHERE t.id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    const messages = await db.query(
      `SELECT m.id, m.sender, m.admin_id, m.via, m.text, m.photo_file_id, m.created_at,
              a.name AS admin_name
       FROM support_messages m
       LEFT JOIN users a ON a.telegram_id = m.admin_id
       WHERE m.ticket_id = $1
       ORDER BY m.created_at ASC`,
      [id]
    );
    res.json({ ticket: rows[0], messages: messages.rows });
  } catch (err) { next(err); }
});

// Ответ из админки: уходит пользователю в Telegram от имени бота поддержки
router.post("/support/tickets/:id/reply", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text || text.length > 4000) return res.status(400).json({ error: "text_required" });

    const { rows } = await db.query("SELECT * FROM support_tickets WHERE id = $1", [id]);
    const ticket = rows[0];
    if (!ticket) return res.status(404).json({ error: "not_found" });
    if (ticket.status !== "open") return res.status(409).json({ error: "ticket_closed" });

    const sent = await supportBot.sendMessage(ticket.user_id, `💬 Ответ поддержки Bytwise:\n\n${text}`);
    // 403 = пользователь заблокировал бота. Ответ всё равно сохраняем в историю,
    // но предупреждаем админа (warning в ответе → жёлтое уведомление на фронте).
    const blocked = !sent.ok && sent.error_code === 403;
    if (!sent.ok && !blocked && !sent.mock) {
      return res.status(502).json({ error: "telegram_send_failed" });
    }

    const ins = await db.query(
      `INSERT INTO support_messages (ticket_id, sender, admin_id, via, text)
       VALUES ($1, 'admin', $2, 'web', $3) RETURNING *`,
      [id, req.admin.telegram_id, text]
    );
    await db.query("UPDATE support_tickets SET updated_at = NOW() WHERE id = $1", [id]);
    await db.logAction(req.admin.id, "admin_action", { action: "support_reply", ticket_id: id });

    supportBot.notifyOtherAdmins(
      req.admin.telegram_id,
      `💬 Тикет №${ticket.ticket_no ?? id}: ответил ${req.admin.name || "админ"} (из админки)`
    ).catch((e) => console.error("[admin] support notify failed:", e.message));

    res.json({ ok: true, message: ins.rows[0], ...(blocked ? { warning: "user_blocked_bot" } : {}) });
  } catch (err) { next(err); }
});

// Закрыть тикет из админки
router.post("/support/tickets/:id/close", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });
    const { rows } = await db.query(
      `UPDATE support_tickets
       SET status = 'closed', closed_at = NOW(), closed_by = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'open' RETURNING *`,
      [id, req.admin.telegram_id]
    );
    const ticket = rows[0];
    if (!ticket) return res.status(409).json({ error: "already_closed" });

    await db.logAction(req.admin.id, "admin_action", { action: "support_close", ticket_id: id });
    // Уведомления — fire-and-forget, закрытие не должно падать из-за Telegram.
    supportBot.sendMessage(
      ticket.user_id,
      `✅ Обращение №${ticket.ticket_no ?? id} закрыто. Если проблема осталась — просто напишите снова, мы создадим новое.`
    ).catch(() => {});
    supportBot.notifyOtherAdmins(
      req.admin.telegram_id,
      `✅ Тикет №${ticket.ticket_no ?? id} закрыл ${req.admin.name || "админ"} (из админки)`
    ).catch(() => {});

    res.json({ ok: true, ticket });
  } catch (err) { next(err); }
});

// Прокси фото из Telegram: <img> не передаст Bearer-токен, поэтому фронт качает
// blob через axios, а сервер стримит файл по file_id бота поддержки.
router.get("/support/photo/:fileId", async (req, res, next) => {
  try {
    const fileId = req.params.fileId;
    if (!/^[\w-]+$/.test(fileId)) return res.status(400).json({ error: "bad_file_id" });
    const url = await supportBot.getFileUrl(fileId);
    if (!url) return res.status(404).json({ error: "file_not_found" });
    const axios = require("axios");
    const upstream = await axios.get(url, { responseType: "stream", timeout: 20000 });
    res.set("Content-Type", upstream.headers["content-type"] || "image/jpeg");
    res.set("Cache-Control", "private, max-age=3600");
    upstream.data.pipe(res);
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ error: "file_not_found" });
    next(err);
  }
});

module.exports = router;
