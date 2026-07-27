// Раздел «Приглашения» в админке: пользовательская программа «Пригласи друга».
// Только просмотр — награда победителю конкурса выдаётся существующей кнопкой
// «выдать N дней PRO» (PATCH /api/admin/users/:id/subscription).
// Механика учёта — в services/userInvites.js и jobs/userInvites.js.
const express = require("express");
const db = require("../db");
const adminAuth = require("../middleware/adminAuth");
const userInvites = require("../services/userInvites");
const inviteRewards = require("../services/inviteRewards");
const { parseId } = require("../utils/http");

const router = express.Router();
router.use(adminAuth);

// Период конкурса из query (?from=YYYY-MM-DD&to=YYYY-MM-DD). Границы включительные:
// «to» разворачивается в конец дня, иначе последний день акции терялся бы целиком.
// Пустые значения → NULL, и SQL-условие ($n IS NULL OR ...) пропускает всё.
//
// Даты трактуем ПО МОСКВЕ — как и вся остальная статистика приглашений. Иначе
// new Date("2026-07-01") дало бы полночь UTC (= 03:00 МСК) и первые три часа первого дня
// акции выпали бы из подсчёта, а конец дня уехал бы по таймзоне сервера. Смещение
// зашито как +03:00: в России нет перехода на летнее время с 2014 года.
const MSK_OFFSET = "+03:00";

function parseRange(q) {
  const norm = (v, endOfDay) => {
    const s = String(v || "").trim();
    if (!s) return null;
    // Голая дата YYYY-MM-DD — достраиваем до момента по Москве; всё остальное
    // (полный ISO с зоной) отдаём Date как есть.
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? `${s}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}${MSK_OFFSET}`
      : s;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return { from: norm(q.from, false), to: norm(q.to, true) };
}

// GET /api/admin/invites?from=&to= — сводка за период + топ приглашающих.
// Победитель конкурса — первая строка топа: сортировка по засчитанным, при равенстве
// приоритет у того, кто привёл больше людей всего.
router.get("/", async (req, res, next) => {
  try {
    const { from, to } = parseRange(req.query);
    const params = [from, to];
    const inRange = (col) => `($1::timestamptz IS NULL OR ${col} >= $1) AND ($2::timestamptz IS NULL OR ${col} <= $2)`;

    const [summary, top] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
                COUNT(DISTINCT inviter_id)::int AS inviters,
                (SELECT COUNT(*)::int FROM user_invite_clicks c WHERE ${inRange("c.clicked_at")}) AS clicks
           FROM user_invites WHERE ${inRange("created_at")}`,
        params
      ).then((r) => r.rows[0]),
      db.query(
        `SELECT u.id, u.telegram_id, u.name, u.username, u.invite_code,
                COUNT(*) FILTER (WHERE i.status = 'confirmed')::int AS confirmed,
                COUNT(*) FILTER (WHERE i.status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE i.status = 'rejected')::int AS rejected,
                COUNT(*)::int AS total,
                (SELECT COUNT(*)::int FROM user_invite_clicks c
                  WHERE c.inviter_id = u.id AND ${inRange("c.clicked_at")}) AS clicks,
                MAX(i.created_at) AS last_invite_at
           FROM user_invites i JOIN users u ON u.id = i.inviter_id
          WHERE ${inRange("i.created_at")}
          GROUP BY u.id
          ORDER BY confirmed DESC, total DESC, last_invite_at DESC
          LIMIT 100`,
        params
      ).then((r) => r.rows)
    ]);

    res.json({
      summary,
      top: top.map((r) => ({ ...r, link: r.invite_code ? userInvites.buildLink(r.invite_code) : null }))
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/invites/feed?status=&page=&limit= — сквозная лента всех приглашений.
// Объявлен ДО /:userId, иначе «feed» уехал бы в парсер id.
router.get("/feed", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const status = ["pending", "confirmed", "rejected"].includes(req.query.status) ? req.query.status : null;
    const { from, to } = parseRange(req.query);
    const params = [status, from, to];
    const where = `($1::text IS NULL OR i.status = $1)
                   AND ($2::timestamptz IS NULL OR i.created_at >= $2)
                   AND ($3::timestamptz IS NULL OR i.created_at <= $3)`;

    const [total, rows] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS c FROM user_invites i WHERE ${where}`, params)
        .then((r) => r.rows[0].c),
      db.query(
        `SELECT i.id, i.status, i.reject_reason, i.created_at, i.decided_at,
                inv.id AS inviter_id, inv.name AS inviter_name, inv.username AS inviter_username,
                u.id AS user_id, u.name AS user_name, u.username AS user_username, u.telegram_id,
                u.app_opened, u.channel_member, u.tg_unreachable,
                EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'succeeded') AS user_paid
           FROM user_invites i
           JOIN users inv ON inv.id = i.inviter_id
           JOIN users u ON u.id = i.user_id
          WHERE ${where}
          ORDER BY i.created_at DESC
          LIMIT $4 OFFSET $5`,
        [...params, limit, (page - 1) * limit]
      ).then((r) => r.rows)
    ]);

    res.json({ items: rows, total, page, limit, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/invites/:userId — карточка приглашающего: его ссылка, цифры,
// график за 30 дней и все приведённые поимённо.
router.get("/:userId", async (req, res, next) => {
  try {
    const id = parseId(req.params.userId);
    if (!id) return res.status(400).json({ error: "bad_id" });

    const { rows: users } = await db.query(
      "SELECT id, telegram_id, name, username, invite_code, created_at FROM users WHERE id = $1",
      [id]
    );
    const user = users[0];
    if (!user) return res.status(404).json({ error: "not_found" });

    const [stats, invites, chart, rewards] = await Promise.all([
      userInvites.statsForUser(id),
      db.query(
        `SELECT i.id, i.status, i.reject_reason, i.created_at, i.decided_at,
                u.id AS user_id, u.name, u.username, u.telegram_id,
                u.app_opened, u.channel_member, u.tg_unreachable,
                EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'succeeded') AS user_paid
           FROM user_invites i JOIN users u ON u.id = i.user_id
          WHERE i.inviter_id = $1
          ORDER BY i.created_at DESC`,
        [id]
      ).then((r) => r.rows),
      // График за 30 дней по московским датам: переходы и приглашённые.
      db.query(
        `SELECT d.day::text AS day,
                (SELECT COUNT(*)::int FROM user_invite_clicks c
                  WHERE c.inviter_id = $1 AND (c.clicked_at AT TIME ZONE $2)::date = d.day) AS clicks,
                (SELECT COUNT(*)::int FROM user_invites i
                  WHERE i.inviter_id = $1 AND i.status <> 'rejected'
                    AND (i.created_at AT TIME ZONE $2)::date = d.day) AS invites
           FROM generate_series((NOW() AT TIME ZONE $2)::date - 29, (NOW() AT TIME ZONE $2)::date, interval '1 day') AS d(day)
          ORDER BY d.day`,
        [id, userInvites.TZ]
      ).then((r) => r.rows),
      inviteRewards.listForUser(id)
    ]);

    res.json({
      user: { ...user, link: user.invite_code ? userInvites.buildLink(user.invite_code) : null },
      stats,
      invites,
      chart,
      rewards
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
// Для тестов: границы периода — самое хрупкое место (от них зависит победитель).
module.exports.parseRange = parseRange;
