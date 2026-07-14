// Расчёт суточной нормы КБЖУ по формуле Миффлина-Сан Жеора.
// Норма считается от ЦЕЛЕВОГО веса (метод целевого веса): организму даётся столько калорий,
// сколько нужно человеку с желаемым весом — так норма реагирует на смену цели по весу.

// 5-уровневая шкала активности (стандартные множители TDEE).
const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  very_high: 1.9,
  // легаси-значения старых профилей (до 5-уровневой шкалы)
  low: 1.2
};

const GOAL_DELTAS = { loss: -300, maintain: 0, gain: 300 };

// Темп достижения цели масштабирует дефицит/профицит калорий. mid = базовое значение (±300),
// поэтому старые профили без темпа и существующие тесты не меняются.
const PACE_FACTORS = { slow: 0.6, mid: 1.0, fast: 1.5 };
function paceFactor(pace) {
  return PACE_FACTORS[pace] != null ? PACE_FACTORS[pace] : PACE_FACTORS.mid;
}

// Уровень активности из числа тренировок в неделю — единый источник правды.
function activityLevelFromWorkouts(n) {
  const w = Number(n);
  if (!Number.isFinite(w) || w <= 0) return "sedentary";
  if (w <= 2) return "light";
  if (w <= 4) return "moderate";
  if (w <= 6) return "high";
  return "very_high";
}

// Множитель активности из тренировок. Если тренировки не заданы (старые записи),
// мягко падаем на сохранённый enum activity.
function activityFactorFromWorkouts(workouts, fallbackActivity) {
  if (workouts != null && workouts !== "") {
    return ACTIVITY_FACTORS[activityLevelFromWorkouts(workouts)];
  }
  return ACTIVITY_FACTORS[fallbackActivity] || 1.2;
}

// Направление цели из разницы текущего и целевого веса (допуск ~1 кг = поддержание).
function deriveGoal(weight, targetWeight) {
  const w = Number(weight);
  const t = Number(targetWeight);
  if (!t || !w) return "maintain";
  if (t < w - 1) return "loss";
  if (t > w + 1) return "gain";
  return "maintain";
}

// Возвращает { daily_calories, daily_protein, daily_fat, daily_carbs } или null если данных не хватает
function calcDailyNorms({ gender, age, height, weight, target_weight, workouts_per_week, activity, pace }) {
  if (!gender || !age || !height || !weight) return null;

  // BMR считаем от целевого веса (fallback на текущий — для совместимости со старыми профилями).
  const w = Number(target_weight) || Number(weight);
  const h = Number(height);
  const a = Number(age);

  let bmr = 10 * w + 6.25 * h - 5 * a;
  bmr += gender === "male" ? 5 : -161;

  const factor = activityFactorFromWorkouts(workouts_per_week, activity);
  const goal = deriveGoal(weight, target_weight);
  // Дефицит/профицит масштабируется темпом (slow/mid/fast). mid не меняет базовое значение.
  const baseDelta = GOAL_DELTAS[goal] != null ? GOAL_DELTAS[goal] : 0;
  const delta = Math.round(baseDelta * paceFactor(pace));

  // Защитный минимум: метод целевого веса при большом разрыве не должен уводить норму
  // ниже безопасного порога.
  const floor = gender === "male" ? 1500 : 1200;
  const calories = Math.max(Math.round(bmr * factor + delta), floor);

  // Распределение: белок 30%, жир 30%, углеводы 40%
  const protein = Math.round((calories * 0.3) / 4);
  const fat = Math.round((calories * 0.3) / 9);
  const carbs = Math.round((calories * 0.4) / 4);

  return {
    daily_calories: calories,
    daily_protein: protein,
    daily_fat: fat,
    daily_carbs: carbs
  };
}

module.exports = {
  calcDailyNorms,
  ACTIVITY_FACTORS,
  GOAL_DELTAS,
  PACE_FACTORS,
  activityLevelFromWorkouts,
  activityFactorFromWorkouts,
  deriveGoal
};
