const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const jwtUtil = require("../utils/jwt");
const { findActiveLink } = require("../services/links");
const { cabinetAuth, loadCabinet } = require("../middleware/cabinetAuth");
const events = require("../services/events");

const router = express.Router();

// Перебор ссылок бессмыслен (256 бит), но лимит отсекает шум и ботов.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 30;
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: LOGIN_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_attempts" }
});

// Обмен личной ссылки на сессию.
router.post("/link", loginLimiter, async (req, res, next) => {
  try {
    const link = await findActiveLink(db, req.body?.token);
    if (!link) return res.status(401).json({ error: "invalid_link" });
    await db.query("UPDATE access_links SET last_used_at = NOW() WHERE id = $1", [link.id]);
    const cabinet = await loadCabinet(link.id);
    // Первый вход директора по выданной ссылке - комбинату видно, что приглашение дошло.
    if (cabinet.role === "director" && !link.last_used_at) {
      await events.record(db, {
        kombinatId: cabinet.kombinatId,
        schoolId: cabinet.schoolId,
        audience: "kombinat",
        kind: "director_joined",
        text: `${events.schoolLabel(cabinet)}: директор вошёл в кабинет по новой ссылке (${cabinet.fullName})`,
        link: `/kombinat/schools?focus=school-${cabinet.schoolId}`
      });
    }
    res.json({ token: jwtUtil.sign({ lid: link.id }), cabinet });
  } catch (err) {
    next(err);
  }
});

router.get("/me", cabinetAuth(), (req, res) => {
  res.json({ cabinet: req.cabinet });
});

module.exports = router;
