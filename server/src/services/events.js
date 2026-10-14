// Лента уведомлений («колокольчик»): что нового случилось в школах и в каталоге комбината.
// Событие видит одна сторона: audience = 'kombinat' - комбинат, 'director' - директор
// своей школы (school_id) или все директора комбината (school_id = NULL).

const db = require("../db");

const FEED_LIMIT = 30;

// Запись события. Уведомление - побочный эффект: его сбой не должен ломать само действие.
async function record(q, { kombinatId, schoolId = null, audience, kind, text, link }) {
  try {
    await q.query(
      `INSERT INTO events (kombinat_id, school_id, audience, kind, text, link)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [kombinatId, schoolId, audience, kind, text, link]
    );
  } catch (err) {
    console.error(`[events] ${kind}:`, err.message);
  }
}

// Последние события для кабинета, новые сверху.
async function feed(cabinet) {
  const { rows } = cabinet.role === "director"
    ? await db.query(
      `SELECT id, kind, text, link, created_at FROM events
        WHERE kombinat_id = $1 AND audience = 'director' AND (school_id IS NULL OR school_id = $2)
        ORDER BY created_at DESC, id DESC LIMIT $3`,
      [cabinet.kombinatId, cabinet.schoolId, FEED_LIMIT]
    )
    : await db.query(
      `SELECT id, kind, text, link, created_at FROM events
        WHERE kombinat_id = $1 AND audience = 'kombinat'
        ORDER BY created_at DESC, id DESC LIMIT $2`,
      [cabinet.kombinatId, FEED_LIMIT]
    );
  return rows;
}

// «15 октября» для текстов событий (дата учебного дня без сдвига пояса).
function dayLabel(iso) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

// Название школы как в базе («Гимназия №33») для текстов событий.
function schoolLabel(cabinet) {
  return cabinet.schoolName || `Школа №${cabinet.schoolNumber}`;
}

module.exports = { record, feed, dayLabel, schoolLabel, FEED_LIMIT };
