// Одноразовый пересчёт дневной нормы КБЖУ по новым правилам (Поправка №37).
// Запуск (на сервере, ОДИН раз после деплоя): npm run recalc
//
// Что делает для КАЖДОГО пользователя:
//  - обновляет производные поля activity (5-уровневый из workouts_per_week) и goal (из весов);
//  - пересчитывает daily_calories/protein/fat/carbs по новой формуле (от целевого веса),
//    НО только если норма НЕ задана тренером и НЕ задана вручную (их значения не трогаем).
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });
const db = require("./index");
const { calcDailyNorms, activityLevelFromWorkouts, deriveGoal } = require("../utils/calories");

(async () => {
  try {
    const { rows } = await db.query("SELECT * FROM users");
    let normsUpdated = 0;
    let fieldsUpdated = 0;
    let skipped = 0;

    for (const u of rows) {
      // Производные поля обновляем всем (на отображение нормы тренера/ручной они не влияют).
      const activity = u.workouts_per_week != null ? activityLevelFromWorkouts(u.workouts_per_week) : u.activity;
      const goal = deriveGoal(u.weight, u.target_weight);

      // Норму пересчитываем только если её не зафиксировал тренер/пользователь.
      const canRecalc = !u.goals_set_by_trainer && !u.goals_set_manually;
      const norms = canRecalc ? calcDailyNorms(u) : null;

      if (!canRecalc) skipped++;

      await db.query(
        `UPDATE users SET
           activity = $2,
           goal = $3,
           daily_calories = COALESCE($4, daily_calories),
           daily_protein  = COALESCE($5, daily_protein),
           daily_fat      = COALESCE($6, daily_fat),
           daily_carbs    = COALESCE($7, daily_carbs)
         WHERE id = $1`,
        [u.id, activity, goal,
         norms?.daily_calories ?? null, norms?.daily_protein ?? null,
         norms?.daily_fat ?? null, norms?.daily_carbs ?? null]
      );
      fieldsUpdated++;
      if (norms) normsUpdated++;
    }

    console.log(`[recalc] всего пользователей: ${rows.length}`);
    console.log(`[recalc] обновлены activity/goal: ${fieldsUpdated}`);
    console.log(`[recalc] пересчитана норма КБЖУ: ${normsUpdated}`);
    console.log(`[recalc] норма не тронута (тренер/вручную): ${skipped}`);
    console.log("[recalc] done");
    process.exit(0);
  } catch (err) {
    console.error("[recalc] failed:", err.message);
    process.exit(1);
  }
})();
