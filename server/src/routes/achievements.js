const express = require("express");
const auth = require("../middleware/auth");
const achievements = require("../services/achievements");

const router = express.Router();

// GET /api/achievements - каталог + статус разблокировки текущего пользователя
router.get("/", auth, async (req, res, next) => {
  try {
    const data = await achievements.getForUser(req.user.id, req.user);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
