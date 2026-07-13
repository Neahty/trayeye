const express = require("express");
const settings = require("../utils/settings");

const router = express.Router();

// GET /api/settings/public — публичные настройки для paywall/онбординга
router.get("/public", async (req, res, next) => {
  try {
    const s = await settings.getMany([
      "welcome_text", "paywall_text", "tariffs",
      "sub_price_basic", "sub_price_trainer", "support_links", "free_scan_daily_limit", "trial_days"
    ]);
    // Приложению отдаём только включённые тарифы.
    const tariffs = Array.isArray(s.tariffs) ? s.tariffs.filter((t) => t && t.enabled !== false) : [];
    res.json({
      welcome_text: s.welcome_text,
      paywall_text: s.paywall_text,
      tariffs,
      price_basic: s.sub_price_basic,
      price_trainer: s.sub_price_trainer,
      support_links: s.support_links,
      free_scan_daily_limit: s.free_scan_daily_limit,
      trial_days: s.trial_days
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
