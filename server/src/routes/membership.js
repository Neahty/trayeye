const express = require("express");
const auth = require("../middleware/auth");
const { isChannelMember } = require("../services/telegram");

const router = express.Router();

// GET /api/membership — подписан ли текущий пользователь на обязательный канал.
router.get("/", auth, async (req, res, next) => {
  try {
    const force = req.query.force === "1" || req.query.force === "true";
    const subscribed = await isChannelMember(req.user.telegram_id, { force });
    res.json({
      subscribed,
      channel_url: process.env.REQUIRED_CHANNEL_URL || null
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
