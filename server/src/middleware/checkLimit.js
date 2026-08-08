const db = require("../db");
const { hasEffectiveAccess } = require("../utils/subscription");
const settings = require("../utils/settings");
const { userTz } = require("../utils/tz");
const { sendMessage } = require("../services/telegram");

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "Bytwise_bot";

// Апселл-пуш при исчерпании дневного лимита сканов у пробного юзера.
// Дедуп 1/сутки — атомарно через UPDATE ... RETURNING: право на пуш «занимает»
// только тот запрос, что реально обновил дату (гонок одновременных сканов нет).
async function maybeSendLimitPush(user, dailyLimit, tz) {
  const cfg = await settings.get("limit_push");
  if (!cfg || cfg.enabled === false || !cfg.text) return;
  const { rowCount } = await db.query(
    `UPDATE users SET limit_push_at = NOW()
     WHERE id = $1 AND (limit_push_at IS NULL OR (limit_push_at AT TIME ZONE $2)::date < (NOW() AT TIME ZONE $2)::date)`,
    [user.id, tz]
  );
  if (!rowCount) return; // сегодня уже слали
  const text = String(cfg.text).replace(/\{limit\}/g, dailyLimit);
  const button = { text: cfg.button_text || "Оформить Pro", url: `https://t.me/${BOT_USERNAME}?startapp=paywall` };
  const res = await sendMessage(user.telegram_id, text, { reply_markup: { inline_keyboard: [[button]] } });
  // Заблокировал бота / не начинал диалог — помечаем, чтобы не слать впустую (как в broadcast.js).
  if (res && res.error_code === 403) {
    await db.query("UPDATE users SET tg_unreachable = TRUE WHERE id = $1", [user.id]);
  }
}

// Модель лимита:
//  - активная подписка ИЛИ доступ от активного тренера -> безлимит
//  - бесплатный период: trial_days дней с момента регистрации, но не более free_scan_daily_limit в день
module.exports = async function checkLimit(req, res, next) {
  try {
    const user = req.user;

    // req.scanLimit — состояние лимита на момент запроса. Нужно роуту скана, чтобы
    // показать остаток в логе канала, не делая тот же подсчёт второй раз.
    if (await hasEffectiveAccess(user.id)) {
      req.scanLimit = { unlimited: true };
      return next();
    }

    const trialDays = Number(await settings.get("trial_days")) || 3;
    const dailyLimit = Number(await settings.get("free_scan_daily_limit")) || 10;

    const trialStart = new Date(user.trial_started_at || user.created_at);
    const trialEnd = new Date(trialStart.getTime() + trialDays * 24 * 60 * 60 * 1000);
    if (Date.now() >= trialEnd.getTime()) {
      return res.status(403).json({ error: "limit", reason: "trial_expired" });
    }

    const tz = userTz(user);
    // Считаем ПРИЁМЫ (одно фото/текст = один batch_id), а не отдельные блюда: фото из нескольких
    // блюд — это одна запись лимита, а не N. Старые строки без batch_id считаем по id.
    // Известное ограничение: проверка и последующая вставка скана не атомарны — несколько
    // строго одновременных запросов могут превысить лимит на 1-2 скана. Риск принят осознанно:
    // ущерб — копейки на AI-вызовах, а честная защита (advisory lock на пользователя) усложнила
    // бы код и добавила точку ожидания на каждый скан.
    const { rows } = await db.query(
      `SELECT COUNT(DISTINCT COALESCE(batch_id, id::text))::int AS cnt FROM scans
       WHERE user_id = $1
         AND (scanned_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date`,
      [user.id, tz]
    );
    const todayCount = rows[0]?.cnt || 0;
    req.scanLimit = { unlimited: false, limit: dailyLimit, used: todayCount, left: Math.max(0, dailyLimit - todayCount) };
    if (todayCount >= dailyLimit) {
      // Апселл-пуш шлём в фоне, не задерживая ответ; ошибки/недоступность гасим внутри.
      maybeSendLimitPush(user, dailyLimit, tz).catch((e) => console.error("[limitPush]", e.message));
      return res.status(403).json({ error: "limit", reason: "daily_cap", limit: dailyLimit });
    }

    next();
  } catch (err) {
    next(err);
  }
};
