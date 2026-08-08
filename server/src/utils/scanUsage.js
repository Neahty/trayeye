const db = require("../db");

// Сколько ПРИЁМОВ пищи человек записал сегодня (в своём часовом поясе).
// Считаем именно приёмы: одно фото/описание = один batch_id, даже если распознано несколько
// блюд — для лимита это одна запись, а не N. Старые строки без batch_id считаем по id.
//
// Один и тот же счёт нужен и middleware/checkLimit.js (пускать ли скан), и routes/profile.js
// (сколько сканов осталось — показать на пейволле), поэтому запрос живёт здесь: разъедутся
// формулы — пользователь увидит «осталось 2» и получит отказ.
async function countScansToday(userId, tz) {
  const { rows } = await db.query(
    `SELECT COUNT(DISTINCT COALESCE(batch_id, id::text))::int AS cnt FROM scans
      WHERE user_id = $1
        AND (scanned_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date`,
    [userId, tz]
  );
  return rows[0]?.cnt || 0;
}

// Сколько дней пробного периода осталось: 1 = «последний день, сегодня ещё работает».
// Пробный уже кончился — 0.
function trialDaysLeft(trialEnd) {
  const ms = new Date(trialEnd).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.max(1, Math.ceil(ms / 86400000));
}

module.exports = { countScansToday, trialDaysLeft };
