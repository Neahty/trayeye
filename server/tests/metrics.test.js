const m = require("../src/services/metrics");

// Строка «блюдо за день» с разумными значениями по умолчанию.
function row(over = {}) {
  return {
    date: "2026-10-12", dish_id: 1, name: "Борщ", category: "soup", image_url: null,
    portion_price: 50, portion_grams: 250, planned: 100, trays: 80, eaten: 72, ...over
  };
}

describe("wasteSummary", () => {
  test("считает отходы как заказано минус съедено, в рублях и процентах", () => {
    const s = m.wasteSummary([row({ planned: 100, eaten: 80, portion_price: 50 })]);
    expect(s).toEqual({ plannedRub: 5000, wasteRub: 1000, wastePct: 20 });
  });

  test("не уходит в минус, если съели больше заказанного", () => {
    expect(m.wasteSummary([row({ planned: 10, eaten: 12 })]).wasteRub).toBe(0);
  });

  test("пустой день - нулевые списания без деления на ноль", () => {
    expect(m.wasteSummary([])).toEqual({ plannedRub: 0, wasteRub: 0, wastePct: 0 });
  });
});

describe("baselineWastePct и savingsRub", () => {
  test("исходный уровень берётся по первым 5 датам", () => {
    const rows = [];
    for (let d = 1; d <= 7; d++) {
      const date = `2026-10-0${d}`;
      rows.push(row({ date, eaten: d <= 5 ? 80 : 100 }));
    }
    expect(m.baselineWastePct(rows)).toBe(20);
  });

  test("экономия = разница уровней × заказ дня", () => {
    expect(m.savingsRub(20, { wastePct: 7, plannedRub: 100000 })).toBe(13000);
  });
});

describe("eatenPct и kidsSummary", () => {
  test("доля съеденного на подносе", () => {
    expect(m.eatenPct(row({ trays: 80, eaten: 60 }))).toBe(75);
    expect(m.eatenPct(row({ trays: 0 }))).toBeNull();
  });

  test("посещаемость в процентах", () => {
    expect(m.kidsSummary(847, 900)).toEqual({ present: 847, students: 900, pct: 94 });
    expect(m.kidsSummary(0, 0).pct).toBe(0);
  });
});

describe("forecast", () => {
  // 4 недели истории: в среду (2026-10-07 и т.д.) берут меньше.
  function history() {
    const rows = [];
    const attendance = [];
    const days = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-05", "2026-10-06", "2026-10-07"];
    for (const date of days) {
      const isWednesday = date === "2026-09-30" || date === "2026-10-07";
      attendance.push({ date, present: 100 });
      rows.push(row({ date, trays: isWednesday ? 70 : 90, eaten: 60 }));
    }
    return { rows, attendance };
  }

  test("прогноз = явка × доля взявших × поправка дня недели + запас", () => {
    const { rows, attendance } = history();
    const menu = [{ dish_id: 1, name: "Борщ", category: "soup", image_url: null, portion_price: 50, planned: 120 }];
    const [item] = m.forecast({ targetDate: "2026-10-14", menu, history: rows, attendance, students: 110 });
    // доля взявших 0.8333, в среду 0.7/0.8333 → 0.84; 100 × 0.8333 × 0.84 × 1.03 = 72.1 → 73
    expect(item.forecast).toBe(73);
    expect(item.usual).toBe(120);
    expect(item.diff).toBe(47);
    expect(item.diffRub).toBe(2350);
  });

  test("для нового блюда берёт долю по категории", () => {
    const { rows, attendance } = history();
    const menu = [{ dish_id: 99, name: "Щи", category: "soup", image_url: null, portion_price: 40, planned: 100 }];
    const [item] = m.forecast({ targetDate: "2026-10-13", menu, history: rows, attendance, students: 110 });
    expect(item.forecast).toBeGreaterThan(80);
    expect(item.forecast).toBeLessThan(100);
  });

  test("без истории прогноз опирается на число учеников", () => {
    const menu = [{ dish_id: 1, name: "Борщ", category: "soup", image_url: null, portion_price: 50, planned: 100 }];
    const [item] = m.forecast({ targetDate: "2026-10-13", menu, history: [], attendance: [], students: 100 });
    expect(item.forecast).toBe(103);
  });
});

describe("recommendations", () => {
  test("советует уменьшить порции в день, когда едят меньше", () => {
    const rows = [];
    const attendance = [];
    for (const date of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]) {
      attendance.push({ date, present: 100 });
      rows.push(row({ date, trays: 90, eaten: date === "2026-10-07" ? 60 : 85 }));
    }
    // доля съеденного: обычно 85/90, в среду 60/90 → среда на 24% ниже среднего
    const tips = m.recommendations({ targetDate: "2026-10-14", history: rows, attendance, forecastItems: [] });
    expect(tips[0]).toEqual({ type: "weekday", text: "В среду дети едят меньше. Уменьшите порции на 24%." });
  });

  test("предлагает заменить блюдо, которое мало кто берёт", () => {
    const attendance = [{ date: "2026-10-05", present: 100 }, { date: "2026-10-06", present: 100 }];
    const rows = attendance.map((a) => row({ date: a.date, name: "Винегрет", trays: 50, eaten: 45 }));
    const tips = m.recommendations({ targetDate: "2026-10-07", history: rows, attendance, forecastItems: [] });
    expect(tips.map((t) => t.text)).toContain("«Винегрет» берут только 50% детей. Замените блюдо в меню.");
  });

  test("суммирует возможную экономию по прогнозу", () => {
    const forecastItems = [{ diff: 60, diffRub: 2880 }, { diff: -5, diffRub: -100 }, { diff: 40, diffRub: 1000 }];
    const tips = m.recommendations({ targetDate: "2026-10-14", history: [], attendance: [], forecastItems });
    expect(tips).toHaveLength(1);
    expect(tips[0].type).toBe("forecast");
    expect(tips[0].text).toContain("на 100 порций меньше");
  });
});

describe("dishStats и dailySeries", () => {
  test("сортирует блюда от нелюбимых к любимым", () => {
    const rows = [row({ dish_id: 1, name: "Борщ", trays: 10, eaten: 9 }), row({ dish_id: 2, name: "Винегрет", trays: 10, eaten: 4 })];
    expect(m.dishStats(rows).map((d) => d.name)).toEqual(["Винегрет", "Борщ"]);
  });

  test("ряд по дням идёт по возрастанию дат и содержит посещаемость", () => {
    const rows = [row({ date: "2026-10-06" }), row({ date: "2026-10-05" })];
    const series = m.dailySeries(rows, [{ date: "2026-10-05", present: 90 }], 100);
    expect(series.map((s) => s.date)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(series[0].kids.pct).toBe(90);
    expect(series[1].kids.present).toBe(0);
  });
});

describe("periodSummary", () => {
  test("добавляет съедаемость, исходный уровень и экономию за период", () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
    // Первые 5 дней - исходный уровень: съели 60 из 100, списания 40%.
    const base = days.map((date) => row({ date, planned: 100, eaten: 60, trays: 100, portion_price: 10 }));
    // Потом списания 10%: экономия (40% - 10%) * 1000 ₽ = 300 ₽.
    const after = row({ date: "2026-10-06", planned: 100, eaten: 90, trays: 100, portion_price: 10 });
    const s = m.periodSummary([...base, after]);
    expect(s.baselinePct).toBe(40);
    expect(s.baselineEatenPct).toBe(60);
    expect(s.eatenPct).toBe(65);
    expect(s.savingsRub).toBe(300);
    expect(s.wastePct).toBe(35);
  });

  test("без данных возвращает нули и пустую съедаемость", () => {
    expect(m.periodSummary([])).toMatchObject({ plannedRub: 0, wasteRub: 0, savingsRub: 0, eatenPct: null });
  });

  test("ряд по дням содержит съедаемость", () => {
    const series = m.dailySeries([row({ trays: 80, eaten: 60 })], [], 100);
    expect(series[0].eatenPct).toBe(75);
  });
});

describe("onlyScannedDays", () => {
  test("убирает дни школы, по которым камера ещё ничего не сняла", () => {
    const rows = [
      row({ school_id: 1, date: "2026-10-13", trays: 80 }),
      row({ school_id: 1, date: "2026-10-14", trays: 0, eaten: 0 }),
      row({ school_id: 2, date: "2026-10-14", trays: 5 }),
      row({ school_id: 2, date: "2026-10-14", dish_id: 2, trays: 0, eaten: 0 })
    ];
    const kept = m.onlyScannedDays(rows);
    expect(kept.map((r) => `${r.school_id}:${r.date}:${r.dish_id}`)).toEqual(["1:2026-10-13:1", "2:2026-10-14:1", "2:2026-10-14:2"]);
  });
});
