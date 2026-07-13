const {
  findFoodData,
  scaleByPortion,
  buildRecommendation
} = require("../src/utils/nutrition");

describe("findFoodData", () => {
  test("matches exact key in database", () => {
    const food = findFoodData("pizza");
    expect(food.matched).toBe(true);
    expect(food.name).toBe("Пицца");
    expect(food.calories).toBe(266);
    expect(food.defaultPortion).toBe(300);
  });

  test("returns default portion for fruit", () => {
    expect(findFoodData("apple").defaultPortion).toBe(180);
    expect(findFoodData("banana").defaultPortion).toBe(120);
  });

  test("returns default portion for small items", () => {
    expect(findFoodData("butter").defaultPortion).toBe(15);
    expect(findFoodData("nuts").defaultPortion).toBe(30);
  });

  test("default portion falls back to 200 for unknown labels", () => {
    expect(findFoodData("unknown_food_xyz").defaultPortion).toBe(200);
  });

  test("matches case-insensitively", () => {
    const food = findFoodData("PIZZA");
    expect(food.matched).toBe(true);
    expect(food.name).toBe("Пицца");
  });

  test("matches when label contains a known key", () => {
    const food = findFoodData("grilled_chicken_breast");
    expect(food.matched).toBe(true);
    expect(food.name).toBe("Куриная грудка");
  });

  test("returns approximate data for unknown labels", () => {
    const food = findFoodData("unknown_food_xyz");
    expect(food.matched).toBe(false);
    expect(food.name).toContain("приблизительно");
    expect(food.calories).toBe(200);
  });

  test("returns fallback for empty label", () => {
    const food = findFoodData("");
    expect(food).toBeNull();
  });
});

describe("scaleByPortion", () => {
  test("scales calories and macros linearly", () => {
    const base = { name: "Test", matched: true, calories: 100, protein: 10, fat: 5, carbs: 20 };
    const scaled = scaleByPortion(base, 200);
    expect(scaled.calories).toBe(200);
    expect(scaled.protein).toBe(20);
    expect(scaled.fat).toBe(10);
    expect(scaled.carbs).toBe(40);
    expect(scaled.portionSize).toBe(200);
  });

  test("handles half portions", () => {
    const base = { name: "Test", matched: true, calories: 200, protein: 10, fat: 5, carbs: 20 };
    const scaled = scaleByPortion(base, 50);
    expect(scaled.calories).toBe(100);
    expect(scaled.protein).toBe(5);
  });

  test("uses food.defaultPortion when portion is missing", () => {
    const base = {
      name: "Test",
      matched: true,
      calories: 100,
      protein: 1,
      fat: 1,
      carbs: 1,
      defaultPortion: 300
    };
    const scaled = scaleByPortion(base);
    expect(scaled.portionSize).toBe(300);
    expect(scaled.calories).toBe(300);
    expect(scaled.portionAuto).toBe(true);
  });

  test("marks manual portion as non-auto", () => {
    const base = {
      name: "Test",
      matched: true,
      calories: 100,
      protein: 1,
      fat: 1,
      carbs: 1,
      defaultPortion: 300
    };
    const scaled = scaleByPortion(base, 150);
    expect(scaled.portionSize).toBe(150);
    expect(scaled.portionAuto).toBe(false);
  });

  test("falls back to 200g when no defaultPortion and no input", () => {
    const base = { name: "Test", matched: true, calories: 100, protein: 1, fat: 1, carbs: 1 };
    const scaled = scaleByPortion(base);
    expect(scaled.portionSize).toBe(200);
  });
});

describe("buildRecommendation", () => {
  test("returns warning for high-calorie meals", () => {
    expect(buildRecommendation(500).level).toBe("warning");
  });

  test("returns info for low-calorie meals", () => {
    expect(buildRecommendation(50).level).toBe("info");
  });

  test("returns success for balanced meals", () => {
    expect(buildRecommendation(250).level).toBe("success");
  });
});
