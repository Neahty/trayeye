const { calcDailyNorms, deriveGoal } = require("../src/utils/calories");

// Актуальное поведение (Поправка №37): BMR считается от ЦЕЛЕВОГО веса (fallback - текущий),
// направление цели выводится из разницы весов (deriveGoal), дельта −300/0/+300,
// защитный минимум 1500 (муж.) / 1200 (жен.). Переданный goal игнорируется.
describe("calcDailyNorms (Mifflin-St Jeor, метод целевого веса)", () => {
  test("male, moderate, без целевого веса → maintain", () => {
    // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    // *1.55 = 2759, дельты нет (цель не задана → maintain)
    const n = calcDailyNorms({ gender: "male", age: 30, height: 180, weight: 80, activity: "moderate" });
    expect(n.daily_calories).toBe(2759);
  });

  test("female, low, цель ниже веса → похудение (−300 от нормы целевого веса)", () => {
    // BMR от ЦЕЛЕВОГО веса 55: 10*55 + 6.25*165 - 5*25 - 161 = 550 + 1031.25 - 125 - 161 = 1295.25
    // *1.2 = 1554.3, цель 55 < 60-1 → loss: -300 = 1254.3 -> round 1254 (выше пола 1200)
    const n = calcDailyNorms({ gender: "female", age: 25, height: 165, weight: 60, target_weight: 55, activity: "low" });
    expect(n.daily_calories).toBe(1254);
  });

  test("male, high, цель выше веса → набор (+300 от нормы целевого веса)", () => {
    // BMR от ЦЕЛЕВОГО веса 90: 10*90 + 6.25*180 - 5*30 + 5 = 900 + 1125 - 150 + 5 = 1880
    // *1.725 = 3243, цель 90 > 80+1 → gain: +300 = 3543
    const n = calcDailyNorms({ gender: "male", age: 30, height: 180, weight: 80, target_weight: 90, activity: "high" });
    expect(n.daily_calories).toBe(3543);
  });

  test("защитный минимум: сильно заниженная цель не уводит ниже пола", () => {
    // Маленькая женщина с целью 40 кг: расчёт уходит ниже 1200 → срабатывает пол 1200.
    const n = calcDailyNorms({ gender: "female", age: 40, height: 150, weight: 55, target_weight: 40, activity: "low" });
    expect(n.daily_calories).toBe(1200);
  });

  test("returns null on missing data", () => {
    expect(calcDailyNorms({ gender: "male" })).toBeNull();
  });

  test("macros split 30/30/40", () => {
    const n = calcDailyNorms({ gender: "male", age: 30, height: 180, weight: 80, activity: "moderate" });
    expect(n.daily_protein).toBe(Math.round((n.daily_calories * 0.3) / 4));
    expect(n.daily_fat).toBe(Math.round((n.daily_calories * 0.3) / 9));
    expect(n.daily_carbs).toBe(Math.round((n.daily_calories * 0.4) / 4));
  });
});

describe("темп (pace) масштабирует дефицит/профицит; mid = базовое поведение", () => {
  const gainBase = { gender: "male", age: 30, height: 180, weight: 80, target_weight: 90, activity: "high" };
  // BMR(90)=1880, *1.725=3243. gain: +300*factor.
  test("gain, mid (по умолчанию) = базовое +300", () => {
    expect(calcDailyNorms({ ...gainBase, pace: "mid" }).daily_calories).toBe(3543);
    expect(calcDailyNorms(gainBase).daily_calories).toBe(3543); // без pace === mid
  });
  test("gain, fast = +300*1.5 = +450", () => {
    expect(calcDailyNorms({ ...gainBase, pace: "fast" }).daily_calories).toBe(3693);
  });
  test("gain, slow = +300*0.6 = +180", () => {
    expect(calcDailyNorms({ ...gainBase, pace: "slow" }).daily_calories).toBe(3423);
  });

  const lossBase = { gender: "male", age: 30, height: 180, weight: 90, target_weight: 80, activity: "moderate" };
  // BMR(80)=1780, *1.55=2759. loss: -300*factor.
  test("loss, mid = базовое -300", () => {
    expect(calcDailyNorms({ ...lossBase, pace: "mid" }).daily_calories).toBe(2459);
  });
  test("loss, fast = -450, slow = -180", () => {
    expect(calcDailyNorms({ ...lossBase, pace: "fast" }).daily_calories).toBe(2309);
    expect(calcDailyNorms({ ...lossBase, pace: "slow" }).daily_calories).toBe(2579);
  });
  test("неизвестный/пустой темп → как mid", () => {
    expect(calcDailyNorms({ ...gainBase, pace: "bogus" }).daily_calories).toBe(3543);
  });
});

describe("deriveGoal (направление цели из веса, допуск ~1 кг)", () => {
  test("цель заметно ниже веса → loss", () => expect(deriveGoal(80, 75)).toBe("loss"));
  test("цель заметно выше веса → gain", () => expect(deriveGoal(80, 85)).toBe("gain"));
  test("цель в пределах ±1 кг → maintain", () => expect(deriveGoal(80, 80.5)).toBe("maintain"));
  test("цель не задана → maintain", () => expect(deriveGoal(80, null)).toBe("maintain"));
});
