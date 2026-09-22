const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/track/broadcast/:id?u=&to=&b=  - учёт клика и редирект на целевой URL
router.get("/broadcast/:id", async (req, res, next) => {
  try {
    const broadcastId = Number(req.params.id);
    const userId = Number(req.query.u) || null;
    const button = req.query.b != null ? String(req.query.b) : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;

    let allowed = [];
    if (broadcastId) {
      const b = await db.query("SELECT buttons FROM broadcasts WHERE id = $1", [broadcastId]);
      const btns = b.rows[0]?.buttons;
      allowed = Array.isArray(btns) ? btns.map((x) => x && x.url).filter(Boolean) : [];

      if (userId) {
        const ins = await db.query(
          `INSERT INTO broadcast_clicks (broadcast_id, user_id, button)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
          [broadcastId, userId, button]
        );
        if (ins.rows.length) {
          await db.query("UPDATE broadcasts SET click_count = click_count + 1 WHERE id = $1", [broadcastId]);
        }
      }
    }

    // Открытый редирект закрыт: пускаем только на URL, реально заданные админом в кнопках этой
    // рассылки (иначе ?to= превращался в open-redirect с доверенного домена → фишинг).
    if (to && /^https?:\/\//i.test(to) && allowed.includes(to)) return res.redirect(to);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
