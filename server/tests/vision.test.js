jest.mock("axios");
const axios = require("axios");
const vision = require("../src/services/vision");

const menu = [{ dish_id: 1, name: "Борщ" }, { dish_id: 5, name: "Котлеты" }];

describe("parseItems", () => {
  test("оставляет только блюда из меню, без повторов, проценты 0..100", () => {
    const content = '```json\n{"items":[{"dish_id":1,"leftover_pct":30.4},{"dish_id":1,"leftover_pct":90},{"dish_id":7,"leftover_pct":10},{"dish_id":5,"leftover_pct":140}]}\n```';
    expect(vision.parseItems(content, menu)).toEqual([
      { dish_id: 1, leftover_pct: 30 },
      { dish_id: 5, leftover_pct: 100 }
    ]);
  });

  test("мусор вместо JSON - пустой список", () => {
    expect(vision.parseItems("не знаю", menu)).toEqual([]);
  });

  test("пустая оценка остатка не превращается в «съедено всё»", () => {
    const content = '{"items":[{"dish_id":1,"leftover_pct":null},{"dish_id":5,"leftover_pct":""},{"dish_id":1,"leftover_pct":false},{"dish_id":5,"leftover_pct":"40"}]}';
    expect(vision.parseItems(content, menu)).toEqual([{ dish_id: 5, leftover_pct: 40 }]);
  });

  test("промпт перечисляет меню с id", () => {
    expect(vision.buildPrompt(menu)).toContain("5: Котлеты");
  });
});

describe("analyzeTray", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.resetAllMocks();
  });

  test("без ключей - 503 ai_not_configured", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEYS;
    delete process.env.OPENAI_API_KEY;
    await expect(vision.analyzeTray({ buffer: Buffer.from("x"), mime: "image/jpeg", menu }))
      .rejects.toMatchObject({ status: 503, message: "ai_not_configured" });
  });

  test("если Gemini упал, отвечает OpenAI", async () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.GEMINI_VISION_MODELS = "gemini-test";
    process.env.OPENAI_API_KEY = "o";
    axios.post
      .mockRejectedValueOnce(Object.assign(new Error("quota"), { response: { status: 429 } }))
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '{"items":[{"dish_id":5,"leftover_pct":20}]}' } }] } });
    const result = await vision.analyzeTray({ buffer: Buffer.from("x"), mime: "image/jpeg", menu });
    expect(result.items).toEqual([{ dish_id: 5, leftover_pct: 20 }]);
    expect(result.model).toBe("gpt-4.1");
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
