const { parseDishes, fallbackDish } = require("../src/services/openai");

describe("parseDishes", () => {
  test("разбирает валидный JSON с блюдами", () => {
    const content = JSON.stringify({
      analysis: "паста ~300 г",
      dishes: [{ dish_name: "Паста карбонара", calories: 646, protein: 24, fat: 34, carbs: 63, weight_grams: 320, confidence: "medium" }]
    });
    const dishes = parseDishes(content);
    expect(dishes).toHaveLength(1);
    expect(dishes[0].dish_name).toBe("Паста карбонара");
    expect(dishes[0].calories).toBe(646);
  });

  test("разбирает несколько блюд", () => {
    const content = JSON.stringify({
      analysis: "тарелка",
      dishes: [
        { dish_name: "Плов", calories: 500, protein: 20, fat: 18, carbs: 60 },
        { dish_name: "Банан", calories: 105, protein: 1, fat: 0, carbs: 27 }
      ]
    });
    expect(parseDishes(content)).toHaveLength(2);
  });

  test("спасает блюдо из ОБРЕЗАННОГО JSON (массив оборвался)", () => {
    // Ответ упёрся в лимит токенов: первый объект целый, дальше обрыв.
    const truncated =
      '{"analysis":"длинное рассуждение...","dishes":[' +
      '{"dish_name":"Борщ","calories":320,"protein":12,"fat":14,"carbs":30,"weight_grams":400,"confidence":"medium"},' +
      '{"dish_name":"Сметана","calories":';
    const dishes = parseDishes(truncated);
    expect(dishes.length).toBeGreaterThanOrEqual(1);
    expect(dishes[0].dish_name).toBe("Борщ");
    expect(dishes[0].calories).toBe(320);
  });

  test("возвращает пустой массив на пустом/битом ответе", () => {
    expect(parseDishes("")).toEqual([]);
    expect(parseDishes("совсем не json, просто текст")).toEqual([]);
    expect(parseDishes(JSON.stringify({ analysis: "нет еды", dishes: [] }))).toEqual([]);
  });
});

describe("fallbackDish", () => {
  test("создаёт запасное блюдо с низкой уверенностью (еда добавляется всегда)", () => {
    const d = fallbackDish("Тарелка борща со сметаной");
    expect(d.dish_name).toBe("Тарелка борща со сметаной");
    expect(d.confidence).toBe("low");
    expect(typeof d.calories).toBe("number");
  });

  test("без имени берёт «Блюдо»", () => {
    expect(fallbackDish().dish_name).toBe("Блюдо");
    expect(fallbackDish("").dish_name).toBe("Блюдо");
  });
});
