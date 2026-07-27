// Экран «Пригласить друга» в мини-аппе: личная короткая ссылка + своя статистика.
// Доступно всем авторизованным (тренерам и сотрудникам тоже — их механики отдельные).
const express = require("express");
const auth = require("../middleware/auth");
const { ensureInviteCode } = require("../utils/refcode");
const userInvites = require("../services/userInvites");

const router = express.Router();

router.use(auth);

// GET /api/invite — ссылка, текст для «Поделиться» и цифры по своим приглашениям
router.get("/", async (req, res, next) => {
  try {
    // Код мог не выдаться (аккаунты старше Поправки №47) — генерируем лениво.
    const code = await ensureInviteCode(req.user.id);
    const stats = await userInvites.statsForUser(req.user.id);
    res.json({
      code,
      link: userInvites.buildLink(code),
      // Без самой ссылки: при «Поделиться» Telegram (t.me/share/url?url=…&text=…) сам
      // подставит URL из url=. Если оставить её ещё и в тексте — ссылка задвоится.
      share_text: "Считаю калории по фото в Bytwise — оказалось реально удобно. Попробуй →",
      stats
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
