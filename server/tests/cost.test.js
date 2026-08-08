const { costUsd, PRICING } = require("../src/services/cost");

describe("costUsd", () => {
  test("computes cost for known model", () => {
    const c = costUsd("gpt-4o-mini", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
    expect(c).toBeCloseTo(PRICING["gpt-4o-mini"].in + PRICING["gpt-4o-mini"].out, 5);
  });

  test("zero usage -> zero cost", () => {
    expect(costUsd("gpt-4o-mini", { prompt_tokens: 0, completion_tokens: 0 })).toBe(0);
  });

  test("unknown model falls back without throwing", () => {
    const c = costUsd("some-unknown-model", { prompt_tokens: 500000, completion_tokens: 0 });
    expect(c).toBeGreaterThan(0);
  });

  test("handles missing usage object", () => {
    expect(costUsd("gpt-4o-mini")).toBe(0);
  });

  // Gemini считает фото бесплатно. Без этого он попадал бы в FALLBACK-прайс
  // и админка показывала бы расходы, которых на самом деле нет.
  test("gemini is free regardless of tokens or version", () => {
    for (const m of ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-99-unreleased"]) {
      expect(costUsd(m, { prompt_tokens: 5_000_000, completion_tokens: 1_000_000 })).toBe(0);
    }
  });
});

// Кэшированный ввод считается вчетверо дешевле. Без этого оценка расходов завышала
// счёт в ~2.5 раза против реальных данных Costs API — промпт у нас длинный и одинаковый.
describe("costUsd — кэшированный ввод", () => {
  test("кэш дешевле обычного ввода", () => {
    const usage = { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 1_000_000 } };
    expect(costUsd("gpt-4.1", usage)).toBeCloseTo(PRICING["gpt-4.1"].cached, 5);
  });

  test("кэш входит в prompt_tokens, а не прибавляется сверху", () => {
    const half = { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 500_000 } };
    const expected = 0.5 * PRICING["gpt-4.1"].in + 0.5 * PRICING["gpt-4.1"].cached;
    expect(costUsd("gpt-4.1", half)).toBeCloseTo(expected, 5);
  });

  test("без поля деталей считаем всё по полной цене", () => {
    expect(costUsd("gpt-4.1", { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeCloseTo(PRICING["gpt-4.1"].in, 5);
  });

  test("кэша не может быть больше, чем всего ввода", () => {
    const bogus = { prompt_tokens: 1000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 999_999 } };
    expect(costUsd("gpt-4.1", bogus)).toBeGreaterThanOrEqual(0);
    expect(costUsd("gpt-4.1", bogus)).toBeLessThan(costUsd("gpt-4.1", { prompt_tokens: 1000, completion_tokens: 0 }));
  });
});
