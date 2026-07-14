const express = require("express");
const db = require("../db");
const jwtUtil = require("../utils/jwt");
const { validateInitData } = require("../services/telegram");
const notify = require("../services/notify");
const channelMembership = require("../services/channelMembership");
const channelLog = require("../services/channelLog");
const avatarSync = require("../services/avatarSync");
const { uniqueRefCode } = require("../utils/refcode");

// Порог «возвращения после паузы» (дней) для лога reactivation.
const REACTIVATION_DAYS = 14;

const router = express.Router();

function adminIds() {
  return (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// POST /api/auth/telegram  { initData, dev_id? }
router.post("/telegram", async (req, res, next) => {
  try {
    const { initData } = req.body || {};
    let tgUser = null;

    const parsed = validateInitData(initData);
    if (parsed && parsed.user) {
      tgUser = parsed.user;
    } else if (process.env.NODE_ENV !== "production" && (req.body.dev_id || req.query.dev_id)) {
      // Dev-байпас для локального теста вне Telegram
      const devId = String(req.body.dev_id || req.query.dev_id);
      tgUser = { id: Number(devId), first_name: "Dev", username: `dev_${devId}` };
    }

    if (!tgUser || !tgUser.id) {
      return res.status(401).json({ error: "invalid_init_data" });
    }

    const telegramId = String(tgUser.id);
    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || null;
    const username = tgUser.username || null;
    const isAdmin = adminIds().includes(telegramId);

    let { rows } = await db.query("SELECT * FROM users WHERE telegram_id = $1", [telegramId]);
    let user = rows[0];

    if (!user) {
      // ref_code оставляем — это код для ссылок-приглашений тренера (реферальной системы нет).
      const refCode = await uniqueRefCode();
      const ins = await db.query(
        `INSERT INTO users (telegram_id, username, name, ref_code, is_admin, app_opened)
         VALUES ($1,$2,$3,$4,$5,TRUE)
         ON CONFLICT (telegram_id) DO UPDATE SET
           username = COALESCE(EXCLUDED.username, users.username),
           name = COALESCE(EXCLUDED.name, users.name),
           is_admin = users.is_admin OR EXCLUDED.is_admin,
           app_opened = TRUE
         RETURNING *, (xmax = 0) AS inserted`,
        [telegramId, username, name, refCode, isAdmin]
      );
      user = ins.rows[0];
      const wasInserted = user.inserted;
      await db.logAction(user.id, "login", { event: wasInserted ? "register" : "login" });
      // Новый пользователь, попавший в базу сразу через приложение (без /start в боте).
      // Открыть мини-апп можно только подписчику канала, поэтому отмечаем членство —
      // markChannelJoined сам пришлёт лог «Новый пользователь» (один раз). Fire-and-forget.
      if (wasInserted) {
        channelMembership.markChannelJoined(user.id, "app").catch((e) =>
          console.error("[auth] markChannelJoined:", e.message)
        );
      }
    } else {
      // Запомним прошлый вход ДО обновления — для лога «вернулся после паузы».
      const prevLogin = user.last_login_at;
      // Обновить базовые поля + статус админа + активность
      const device = (req.body?.platform || req.headers["user-agent"] || "").toString().slice(0, 200) || null;
      const upd = await db.query(
        `UPDATE users SET username = COALESCE($2, username),
                          name = COALESCE($3, name),
                          is_admin = is_admin OR $4,
                          last_login_at = NOW(),
                          app_opened = TRUE,
                          login_count = COALESCE(login_count, 0) + 1,
                          device = COALESCE($5, device),
                          tg_unreachable = FALSE
         WHERE id = $1 RETURNING *`,
        [user.id, username, name, isAdmin, device]
      );
      user = upd.rows[0];
      await db.logAction(user.id, "login", { event: "login" });
      // Вернулся после долгой паузы — лог в канал (один раз на возвращение).
      if (prevLogin) {
        const daysAway = Math.floor((Date.now() - new Date(prevLogin).getTime()) / 86400000);
        if (daysAway >= REACTIVATION_DAYS) {
          const who = await notify.userLabel(user.id);
          channelLog.post(
            "reactivation",
            `🔄 <b>Вернулся после паузы</b>\n\n` +
            `${who} снова зашёл после ${daysAway} дн. без активности.\n` +
            `Время: ${notify.fmtWhen()}`
          ).catch(() => {});
        }
      }
    }

    if (user.is_blocked) {
      return res.status(403).json({ error: "blocked" });
    }

    // Подтягиваем/обновляем аватарку из Telegram и кэшируем у себя — чтобы фото было
    // всегда, даже если загруженный файл потерялся при миграции БД. Fire-and-forget:
    // вход не должен ждать/падать из-за Bot API.
    avatarSync.syncTelegramAvatar(user).catch((e) =>
      console.error("[auth] syncTelegramAvatar:", e.message)
    );

    const token = jwtUtil.sign({ uid: user.id, telegram_id: user.telegram_id });
    res.json({ token, user: { id: user.id, telegram_id: user.telegram_id, name: user.name, is_admin: user.is_admin } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
