// Экран «Пригласить друга» в мини-аппе: личная короткая ссылка, своя статистика
// и подарки за приглашения (за каждые N друзей - M дней PRO).
// Доступно всем авторизованным (тренерам и сотрудникам тоже - их механики отдельные).
const express = require("express");
const auth = require("../middleware/auth");
const { ensureInviteCode } = require("../utils/refcode");
const userInvites = require("../services/userInvites");
const inviteRewards = require("../services/inviteRewards");

const router = express.Router();

router.use(auth);

// GET /api/invite - ссылка, текст для «Поделиться», цифры и список подарков
router.get("/", async (req, res, next) => {
  try {
    // Код мог не выдаться (аккаунты старше Поправки №47) - генерируем лениво.
    const code = await ensureInviteCode(req.user.id);
    // Подарки начисляет крон, но пересчитываем и здесь: экран сам себя чинит, если
    // процесс упал между подтверждением друга и начислением ступени. Идемпотентно.
    await inviteRewards.syncForUser(req.user.id).catch((e) => console.error("[invite] sync:", e.message));
    const [stats, rewards, cfg] = await Promise.all([
      userInvites.statsForUser(req.user.id),
      inviteRewards.listForUser(req.user.id),
      inviteRewards.config()
    ]);
    res.json({
      code,
      link: userInvites.buildLink(code),
      // Без самой ссылки: при «Поделиться» Telegram (t.me/share/url?url=…&text=…) сам
      // подставит URL из url=. Если оставить её ещё и в тексте - ссылка задвоится.
      share_text: "Считаю калории по фото в Bytwise - оказалось реально удобно. Попробуй →",
      stats,
      rewards,
      reward_rule: cfg.enabled ? { per: cfg.per, days: cfg.days } : null
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/invite/rewards/:id/claim - забрать подарок (то же, что кнопка в ЛС бота)
router.post("/rewards/:id/claim", async (req, res, next) => {
  try {
    const result = await inviteRewards.claim(req.user.id, req.params.id);
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
