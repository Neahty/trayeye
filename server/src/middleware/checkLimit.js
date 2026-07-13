const db = require("../db");
const { hasEffectiveAccess } = require("../utils/subscription");
const settings = require("../utils/settings");
const { userTz } = require("../utils/tz");

// Модель лимита:
//  - активная подписка ИЛИ доступ от активного тренера -> безлимит
//  - бесплатный период: trial_days дней с момента регистрации, но не более free_scan_daily_limit в день
module.exports = async function checkLimit(req, res, next) {
  try {
    const user = req.user;

    if (await hasEffectiveAccess(user.id)) return next();

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
    if (todayCount >= dailyLimit) {
      return res.status(403).json({ error: "limit", reason: "daily_cap", limit: dailyLimit });
    }

    next();
  } catch (err) {
    next(err);
  }
};
