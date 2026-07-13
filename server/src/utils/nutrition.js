const { FOOD_DATABASE, getDefaultPortion } = require("../data/foodDatabase");

function findFoodData(label) {
  if (!label) return null;
  const key = label.toLowerCase().trim().replace(/_/g, " ");
  if (FOOD_DATABASE[key]) {
    return { ...FOOD_DATABASE[key], matched: true, defaultPortion: getDefaultPortion(key) };
  }
  let bestKey = null;
  for (const dbKey of Object.keys(FOOD_DATABASE)) {
    if (key.includes(dbKey) || dbKey.includes(key)) {
      if (!bestKey || dbKey.length > bestKey.length) {
        bestKey = dbKey;
      }
    }
  }
  if (bestKey) {
    return {
      ...FOOD_DATABASE[bestKey],
      matched: true,
      defaultPortion: getDefaultPortion(bestKey)
    };
  }
  const formatted = label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    name: `${formatted} (приблизительно)`,
    calories: 200,
    protein: 10,
    fat: 8,
    carbs: 25,
    matched: false,
    defaultPortion: 200
  };
}

function scaleByPortion(food, portionSize) {
  const requested = portionSize === undefined || portionSize === null || portionSize === ""
    ? null
    : Number(portionSize);
  const auto = requested === null || Number.isNaN(requested) || requested <= 0;
  const portion = auto ? food.defaultPortion || 200 : requested;
  const multiplier = portion / 100;
  return {
    name: food.name,
    matched: food.matched,
    calories: Math.round(food.calories * multiplier),
    protein: Math.round(food.protein * multiplier * 10) / 10,
    fat: Math.round(food.fat * multiplier * 10) / 10,
    carbs: Math.round(food.carbs * multiplier * 10) / 10,
    portionSize: portion,
    portionAuto: auto
  };
}

function buildRecommendation(calories) {
  if (calories > 400) {
    return {
      level: "warning",
      text: "Высококалорийное блюдо. Подходит для основного приема пищи."
    };
  }
  if (calories < 100) {
    return { level: "info", text: "Легкое блюдо. Отлично для перекуса!" };
  }
  return { level: "success", text: "Сбалансированное блюдо." };
}

module.exports = { findFoodData, scaleByPortion, buildRecommendation };
