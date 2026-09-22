const express = require("express");
const auth = require("../middleware/auth");
const quests = require("../services/quests");

const router = express.Router();

// GET /api/quests - список активных квестов со статусом текущего пользователя
router.get("/", auth, async (req, res, next) => {
  try {
    const data = await quests.getForUser(req.user.id, req.user);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/quests/:code/claim - забрать награду (бот шлёт ссылку в ЛС)
router.post("/:code/claim", auth, async (req, res, next) => {
  try {
    const result = await quests.claim(req.user.id, req.user, req.params.code);
    if (!result.ok) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
