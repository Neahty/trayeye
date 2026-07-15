const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const auth = require("../middleware/auth");
const { calcDailyNorms, activityLevelFromWorkouts, deriveGoal } = require("../utils/calories");
const { getActiveSubscription, isTrainer, getActiveTrainer } = require("../utils/subscription");
const { userTz } = require("../utils/tz");
const settings = require("../utils/settings");
const notify = require("../services/notify");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const UPLOADS_ROOT = path.resolve(__dirname, "../../../uploads");

// Отдаём клиенту профиль без служебных/внутренних полей (их фронтенд не использует):
// реф-код приглашений, счётчики входов, устройство, легаси-поля и флаги доставки.
function publicUser(u) {
  const {
    ref_code, login_count, device, last_login_at, free_scans_used,
    referred_by, trial_started_at, tg_unreachable, app_opened, tg_log_new_user_msg,
    ...safe
  } = u;
  return safe;
}

// GET /api/profile
router.get("/", auth, async (req, res, next) => {
  try {
    const sub = await getActiveSubscription(req.user.id);
    const is_trainer = Boolean(sub && sub.type === "trainer");
    const trainer = await getActiveTrainer(req.user.id); // тренер клиента (если есть активный)

    // Последняя подписка ЛЮБОГО статуса — чтобы на пейволле различать «триал закончился»
    // (платной подписки никогда не было) и «подписка закончилась» (была и истекла/отменена).
    const lastSub = await db.query(
      "SELECT type, status, expires_at FROM subscriptions WHERE user_id = $1 ORDER BY expires_at DESC LIMIT 1",
      [req.user.id]
    );

    const trialDays = Number(await settings.get("trial_days")) || 3;
    const trialStart = new Date(req.user.trial_started_at || req.user.created_at);
    const trialEnd = new Date(trialStart.getTime() + trialDays * 86400000);

    // «Сегодня» в поясе пользователя, посчитанное на сервере (полный ICU), чтобы клиент
    // не зависел от урезанного ICU Telegram-webview (отсюда были «6 число вместо 5»).
    const today = await db.query(
      "SELECT to_char(NOW() AT TIME ZONE $1, 'YYYY-MM-DD') AS d",
      [userTz(req.user)]
    );

    res.json({
      user: publicUser(req.user),
      subscription: sub || null,
      last_subscription: lastSub.rows[0] || null,
      is_trainer,
      trainer: trainer ? { id: trainer.id, name: trainer.name, username: trainer.username } : null,
      has_access: Boolean(sub) || Boolean(trainer),
      trial: { ends_at: trialEnd, active: Date.now() < trialEnd.getTime(), days: trialDays },
      server_today: today.rows[0]?.d || null
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/profile
router.patch("/", auth, async (req, res, next) => {
  try {
    const u = req.user;
    const b = req.body || {};

    // Тренировки в неделю — единый источник активности; уровень и направление цели — производные.
    const wpw = b.workouts_per_week ?? u.workouts_per_week;
    const mergedWeight = b.weight ?? u.weight;
    const mergedTarget = b.target_weight ?? u.target_weight;

    const merged = {
      gender: b.gender ?? u.gender,
      age: b.age ?? u.age,
      height: b.height ?? u.height,
      weight: mergedWeight,
      activity: wpw != null ? activityLevelFromWorkouts(wpw) : u.activity,
      goal: deriveGoal(mergedWeight, mergedTarget),
      workouts_per_week: wpw,
      name: b.name ?? u.name,
      email: b.email ?? u.email,
      theme: b.theme ?? u.theme,
      accent: b.accent !== undefined ? b.accent : u.accent,
      units: b.units ?? u.units,
      timezone: b.timezone ?? u.timezone,
      target_weight: b.target_weight ?? u.target_weight,
      pace: b.pace ?? u.pace,
      onboarded: b.onboarded ?? u.onboarded,
      notifications_enabled: b.notifications_enabled ?? u.notifications_enabled
    };

    const weightChanged = b.weight != null && Number(b.weight) !== Number(u.weight);

    let norms = null;
    if (!u.goals_set_by_trainer && !u.goals_set_manually) {
      norms = calcDailyNorms(merged);
    }

    const { rows } = await db.query(
      `UPDATE users SET
         gender=$2, age=$3, height=$4, weight=$5, activity=$6, goal=$7,
         workouts_per_week=$8, name=$9, notifications_enabled=$10,
         email=$11, theme=$12, accent=$13, units=$14,
         timezone=$15, target_weight=$16, onboarded=$17, pace=$18,
         daily_calories = COALESCE($19, daily_calories),
         daily_protein  = COALESCE($20, daily_protein),
         daily_fat      = COALESCE($21, daily_fat),
         daily_carbs    = COALESCE($22, daily_carbs)
       WHERE id=$1 RETURNING *`,
      [u.id, merged.gender, merged.age, merged.height, merged.weight, merged.activity,
       merged.goal, merged.workouts_per_week, merged.name, merged.notifications_enabled,
       merged.email, merged.theme, merged.accent != null ? JSON.stringify(merged.accent) : null, merged.units,
       merged.timezone, merged.target_weight, merged.onboarded, merged.pace,
       norms?.daily_calories ?? null, norms?.daily_protein ?? null,
       norms?.daily_fat ?? null, norms?.daily_carbs ?? null]
    );

    if (weightChanged) {
      await db.query("INSERT INTO weight_history (user_id, weight) VALUES ($1, $2)", [u.id, Number(b.weight)]);
    }

    // Онбординг только что пройден — дописываем анкету в лог «Новый пользователь» в канале.
    // Ловим именно переход FALSE→TRUE, иначе правка летела бы на каждое сохранение профиля.
    if (!u.onboarded && merged.onboarded) {
      notify.refreshNewUserLog(u.id).catch((e) =>
        console.error("[profile] refreshNewUserLog:", e.message)
      );
    }

    await db.logAction(u.id, "profile_update", { weightChanged });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/profile/goals — задать норму КБЖУ вручную
router.patch("/goals", auth, async (req, res, next) => {
  try {
    const u = req.user;
    if (u.goals_set_by_trainer) return res.status(403).json({ error: "goals_set_by_trainer" });

    const b = req.body || {};
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    };
    const cal = num(b.daily_calories);
    if (cal == null) return res.status(400).json({ error: "calories_required" });

    const { rows } = await db.query(
      `UPDATE users SET
         daily_calories = $2,
         daily_protein  = COALESCE($3, daily_protein),
         daily_fat      = COALESCE($4, daily_fat),
         daily_carbs    = COALESCE($5, daily_carbs),
         goals_set_manually = TRUE
       WHERE id = $1 RETURNING *`,
      [u.id, cal, num(b.daily_protein), num(b.daily_fat), num(b.daily_carbs)]
    );
    await db.logAction(u.id, "goal_update", { by: "self" });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/profile/goals/auto — вернуть автоматический расчёт нормы
router.post("/goals/auto", auth, async (req, res, next) => {
  try {
    const u = req.user;
    if (u.goals_set_by_trainer) return res.status(403).json({ error: "goals_set_by_trainer" });

    const norms = calcDailyNorms(u);
    const { rows } = await db.query(
      `UPDATE users SET
         daily_calories = COALESCE($2, daily_calories),
         daily_protein  = COALESCE($3, daily_protein),
         daily_fat      = COALESCE($4, daily_fat),
         daily_carbs    = COALESCE($5, daily_carbs),
         goals_set_manually = FALSE
       WHERE id = $1 RETURNING *`,
      [u.id, norms?.daily_calories ?? null, norms?.daily_protein ?? null,
       norms?.daily_fat ?? null, norms?.daily_carbs ?? null]
    );
    await db.logAction(u.id, "goal_update", { by: "auto" });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/profile/avatar  (multipart: avatar)
router.post("/avatar", auth, upload.single("avatar"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no_file" });
    const dir = path.join(UPLOADS_ROOT, "users", String(req.user.id));
    fs.mkdirSync(dir, { recursive: true });
    const ext = (req.file.mimetype.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const filename = `avatar_${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(dir, filename), req.file.buffer);
    const avatarPath = `uploads/users/${req.user.id}/${filename}`;
    const { rows } = await db.query(
      "UPDATE users SET avatar_path = $2 WHERE id = $1 RETURNING *",
      [req.user.id, avatarPath]
    );
    res.json({ user: publicUser(rows[0]), avatar_path: avatarPath });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
