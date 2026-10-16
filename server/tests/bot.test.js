// Бот без Telegram и базы: коды привязки, тексты сводок, очередь подносов.
const telegram = require("../src/services/telegram");
const texts = require("../src/bot/texts");
const { TrayQueue } = require("../src/bot/trayQueue");

describe("код привязки", () => {
  test("принимает код с пробелами, дефисом и в нижнем регистре", () => {
    expect(telegram.normalizeCode("k7m-2qx")).toBe("K7M2QX");
    expect(telegram.normalizeCode(" K7M 2QX ")).toBe("K7M2QX");
  });

  test("не код - null (длина, буквы 0/O/1/I, пусто)", () => {
    expect(telegram.normalizeCode("K7M2Q")).toBeNull();
    expect(telegram.normalizeCode("K7M2Q0")).toBeNull();
    expect(telegram.normalizeCode("привет")).toBeNull();
    expect(telegram.normalizeCode(undefined)).toBeNull();
  });
});

describe("тексты", () => {
  beforeAll(() => { process.env.PUBLIC_URL = "https://example.ru/trayeye/"; });

  const overview = {
    date: "2026-10-14",
    cards: {
      waste: { pct: 7.5, baselinePct: 20, rub: 100, plannedRub: 1000 },
      savings: { rub: 12400 },
      kids: { present: 847, students: 900, pct: 94 }
    },
    forecast: { date: "2026-10-15", items: [{ name: "Борщ", forecast: 420, usual: 480 }] },
    recommendations: [{ text: "В среду дети едят меньше." }]
  };

  test("сводка директора: списания, экономия, дети, прогноз, совет, ссылка", () => {
    const text = texts.directorSummary({ school_name: "Гимназия №33" }, overview);
    expect(text).toContain("Гимназия №33, 14 октября");
    expect(text).toContain("Списания: 7.5% (было 20%)");
    expect(text).toMatch(/Экономия: 12\s400 ₽/);
    expect(text).toContain("Детей: 847 из 900 (94%)");
    expect(text).toContain("• Борщ - 420 порций (обычно 480)");
    expect(text).toContain("💡 В среду дети едят меньше.");
    expect(text).toContain("https://example.ru/trayeye/director");
  });

  test("до первых сканов списания не выдумываются", () => {
    const empty = { ...overview, cards: { ...overview.cards, waste: { ...overview.cards.waste, pct: null } } };
    expect(texts.directorSummary({ school_name: "Школа" }, empty)).toContain("камера сегодня ещё не снимала");
  });

  test("сводка комбината: худшие школы по списаниям", () => {
    const k = {
      totals: { schools: 2, wastePct: 10, baselinePct: 18, savingsRub: 500, kids: { present: 10, students: 20, pct: 50 } },
      schools: [
        { name: "Школа 1", cards: { waste: { pct: 5 } } },
        { name: "Школа 2", cards: { waste: { pct: 15 } } },
        { name: "Школа 3", cards: { waste: { pct: null } } }
      ]
    };
    const text = texts.kombinatSummary({ kombinat_name: "Комбинат" }, "2026-10-14", k);
    expect(text.indexOf("Школа 2 - 15%")).toBeLessThan(text.indexOf("Школа 1 - 5%"));
    expect(text).not.toContain("Школа 3");
  });

  test("итог подноса: пустой, с остатками, ошибка ИИ", () => {
    expect(texts.trayResult({ is_empty: true })).toContain("без нейросети");
    expect(texts.trayResult({ is_empty: false, items: [{ name: "Борщ", leftover_pct: 30 }] })).toContain("Борщ: осталось 30%");
    expect(texts.trayResult({ error: "ai_failed" })).toContain("не засчитан");
  });
});

describe("очередь подносов", () => {
  afterEach(() => jest.useRealTimers());

  test("набралась пачка - отправляет сразу одним вызовом", async () => {
    const flush = jest.fn().mockResolvedValue();
    const q = new TrayQueue({ flush, batchSize: 3, waitMs: 60000 });
    q.add(1, "a");
    q.add(1, "b");
    expect(flush).not.toHaveBeenCalled();
    await q.add(1, "c");
    expect(flush).toHaveBeenCalledWith(1, ["a", "b", "c"]);
    expect(q.size()).toBe(0);
  });

  test("неполная пачка уходит по таймеру, школы не смешиваются", async () => {
    jest.useFakeTimers();
    const flush = jest.fn().mockResolvedValue();
    const q = new TrayQueue({ flush, batchSize: 8, waitMs: 45000 });
    q.add(1, "a");
    q.add(2, "x");
    q.add(1, "b");
    jest.advanceTimersByTime(45000);
    await Promise.resolve();
    expect(flush).toHaveBeenCalledWith(1, ["a", "b"]);
    expect(flush).toHaveBeenCalledWith(2, ["x"]);
  });
});
