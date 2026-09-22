const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const { userTz } = require("../utils/tz");

const router = express.Router();

// GET /api/history?date=YYYY-MM-DD
router.get("/", auth, async (req, res, next) => {
  try {
    const tz = userTz(req.user);
    const date = req.query.date || new Date().toLocaleDateString("en-CA", { timeZone: tz });
    // «День» считаем в часовом поясе пользователя, а не в UTC.
    // time_label - время приёма уже отформатированное на сервере (полный ICU в Node/PG),
    // чтобы не зависеть от урезанного ICU Telegram-webview (там зоны молча уходили в UTC).
    const { rows } = await db.query(
      `SELECT *, to_char(scanned_at AT TIME ZONE $3, 'HH24:MI') AS time_label
       FROM scans
       WHERE user_id = $1 AND (scanned_at AT TIME ZONE $3)::date = $2::date
       ORDER BY scanned_at ASC
       LIMIT 500`,
      [req.user.id, date, tz]
    );

    const groups = { breakfast: [], lunch: [], dinner: [], snack: [] };
    const total = { calories: 0, protein: 0, fat: 0, carbs: 0 };
    for (const s of rows) {
      (groups[s.meal_type] || groups.snack).push(s);
      total.calories += s.calories || 0;
      total.protein += Number(s.protein) || 0;
      total.fat += Number(s.fat) || 0;
      total.carbs += Number(s.carbs) || 0;
    }
    total.protein = Math.round(total.protein * 10) / 10;
    total.fat = Math.round(total.fat * 10) / 10;
    total.carbs = Math.round(total.carbs * 10) / 10;

    res.json({ date, meals: groups, total });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
