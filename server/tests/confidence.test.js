const { normalizeDish, calibrateConfidence } = require("../src/services/openai");

// Самооценке модели верить нельзя: на боевых данных Gemini ставил "high" в 64% случаев
// и "low" не поставил ни разу, из-за чего в клиенте перестала показываться плашка
// «AI не уверен — проверьте запись». Уверенность решают проверяемые признаки.
const dish = (over = {}) => ({
  dish_name: "Паста карбонара", calories: 646, protein: 24, fat: 34, carbs: 63,
  weight_grams: 320, confidence: "medium", ...over
});

describe("calibrateConfidence", () => {
  test("нормальную оценку не трогает", () => {
    expect(calibrateConfidence(dish(), "medium")).toBe("medium");
  });

  test("оставляет high, когда числа согласованы и вес некруглый", () => {
    expect(calibrateConfidence(dish({ weight_grams: 290, calories: 287, protein: 9.3, fat: 9.9, carbs: 39.2 }), "high")).toBe("high");
  });

  test("нет веса или калорий — всегда low", () => {
    expect(calibrateConfidence(dish({ weight_grams: 0 }), "high")).toBe("low");
    expect(calibrateConfidence(dish({ calories: 0 }), "high")).toBe("low");
  });

  test("физически невозможная плотность — low", () => {
    expect(calibrateConfidence(dish({ calories: 5000, weight_grams: 300 }), "high")).toBe("low"); // 16 ккал/г
    expect(calibrateConfidence(dish({ calories: 20, weight_grams: 300 }), "high")).toBe("low");   // 0.07 ккал/г
  });

  test("обобщённое название = еду не опознали", () => {
    for (const name of ["Блюдо", "еда", " Перекус "]) {
      expect(calibrateConfidence(dish({ dish_name: name }), "high")).toBe("low");
    }
  });

  test("круглый вес снимает незаслуженный high", () => {
    expect(calibrateConfidence(dish({ weight_grams: 200, calories: 404, protein: 15, fat: 21, carbs: 39 }), "high")).toBe("medium");
  });

  test("круглый вес вместе со странной плотностью — low", () => {
    expect(calibrateConfidence(dish({ weight_grams: 200, calories: 1400, protein: 60, fat: 60, carbs: 60 }), "high")).toBe("low");
  });

  test("честно объявленный low не повышается", () => {
    expect(calibrateConfidence(dish(), "low")).toBe("low");
  });
});

describe("normalizeDish применяет калибровку", () => {
  test("high от модели переживает проверку только вместе с числами", () => {
    expect(normalizeDish(dish({ weight_grams: 200, calories: 404, protein: 15, fat: 21, carbs: 39, confidence: "high" })).confidence).toBe("medium");
    expect(normalizeDish(dish({ dish_name: "Блюдо", confidence: "high" })).confidence).toBe("low");
  });
});
