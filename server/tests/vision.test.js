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

describe("пачка подносов", () => {
  test("parseBatch: по каждому фото - подносы, у подноса - блюда из меню", () => {
    const content = JSON.stringify({ photos: [
      { photo: 2, trays: [{ items: [{ dish_id: 5, leftover_pct: 100 }] }, { items: [{ dish_id: 1, leftover_pct: 50 }, { dish_id: 9, leftover_pct: 10 }] }] },
      { photo: 1, trays: [{ items: [{ dish_id: 9, leftover_pct: 0 }] }] },
      { photo: 7, trays: [{ items: [{ dish_id: 1, leftover_pct: 5 }] }] }
    ] });
    expect(vision.parseBatch(content, menu, 3)).toEqual([
      [[]],                                                         // еда есть, но не из меню
      [[{ dish_id: 5, leftover_pct: 100 }], [{ dish_id: 1, leftover_pct: 50 }]],
      null                                                          // про третье фото модель промолчала
    ]);
  });

  test("промпт пачки: несколько подносов на фото и без подсказки «после еды»", () => {
    const prompt = vision.buildBatchPrompt(menu, 4);
    expect(prompt).toContain("Ниже 4 фото");
    expect(prompt).toContain("один или несколько подносов");
    expect(prompt).toContain("100 - порцию не трогали");
    expect(prompt).toContain("не округляй к 50");
    expect(prompt).not.toMatch(/после еды/i);
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

  test("все модели перегружены (503) - ждём и пробуем ещё раз", async () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.GEMINI_VISION_MODELS = "gemini-test";
    delete process.env.OPENAI_API_KEY;
    process.env.AI_RETRY_DELAY_MS = "0";
    axios.post
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { response: { status: 503 } }))
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '{"items":[{"dish_id":1,"leftover_pct":5}]}' } }] } });
    const result = await vision.analyzeTray({ buffer: Buffer.from("x"), mime: "image/jpeg", menu });
    expect(result.items).toEqual([{ dish_id: 1, leftover_pct: 5 }]);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test("ошибка не из-за перегрузки - без повторов", async () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.GEMINI_VISION_MODELS = "gemini-test";
    delete process.env.OPENAI_API_KEY;
    process.env.AI_RETRY_DELAY_MS = "0";
    axios.post.mockRejectedValue(Object.assign(new Error("bad"), { response: { status: 400 } }));
    await expect(vision.analyzeTray({ buffer: Buffer.from("x"), mime: "image/jpeg", menu }))
      .rejects.toMatchObject({ status: 502, message: "ai_failed" });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test("пачка: все подносы в одном запросе, через прокси из AI_PROXY_URL", async () => {
    process.env.GEMINI_API_KEY = "g";
    process.env.GEMINI_VISION_MODELS = "gemini-test";
    delete process.env.OPENAI_API_KEY;
    process.env.AI_PROXY_URL = "http://10.0.0.1:3128";
    axios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify({ photos: [
      { photo: 1, trays: [{ items: [{ dish_id: 1, leftover_pct: 10 }] }] },
      { photo: 2, trays: [{ items: [{ dish_id: 5, leftover_pct: 60 }] }] }
    ] }) } }] } });
    const images = [{ buffer: Buffer.from("a"), mime: "image/jpeg" }, { buffer: Buffer.from("b"), mime: "image/jpeg" }];
    const result = await vision.analyzeTrays({ images, menu });
    expect(result.results).toEqual([[[{ dish_id: 1, leftover_pct: 10 }]], [[{ dish_id: 5, leftover_pct: 60 }]]]);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [, body, options] = axios.post.mock.calls[0];
    expect(body.messages[0].content.filter((c) => c.type === "image_url")).toHaveLength(2);
    expect(options.proxy).toBe(false);
    expect(options.httpsAgent.proxyUrl).toBe("http://10.0.0.1:3128");
  });
});
