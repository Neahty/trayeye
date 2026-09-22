const db = require("../db");

// Сколько ПРИЁМОВ пищи человек записал сегодня (в своём часовом поясе).
// Считаем именно приёмы: одно фото/описание = одна запись в журнале, даже если распознано
// несколько блюд - для лимита это один скан, а не N.
//
// Считаем по system_logs, а НЕ по таблице scans. Раньше считали по scans, и лимит обходился
// тривиально: скан → удалить запись из дневника → счётчик откатился → скан снова. DELETE
// /api/scan/:id удаляет строку физически, так что дневной лимит бесплатных сканов не значил
// ничего, а платные вызовы AI оплачивал владелец. В system_logs строка action='scan' пишется
// всеми тремя роутами (фото, текст, ручной ввод), никогда не удаляется и не зависит от того,
// оставил ли человек запись в дневнике.
//
// Один и тот же счёт нужен и middleware/checkLimit.js (пускать ли скан), и routes/profile.js
// (сколько сканов осталось - показать на пейволле), поэтому запрос живёт здесь: разъедутся
// формулы - пользователь увидит «осталось 2» и получит отказ.
async function countScansToday(userId, tz) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM system_logs
      WHERE user_id = $1 AND action = 'scan'
        AND (created_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date`,
    [userId, tz]
  );
  return rows[0]?.cnt || 0;
}

// Сколько дней пробного периода осталось: 1 = «последний день, сегодня ещё работает».
// Пробный уже кончился - 0.
function trialDaysLeft(trialEnd) {
  const ms = new Date(trialEnd).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.max(1, Math.ceil(ms / 86400000));
}

module.exports = { countScansToday, trialDaysLeft };
