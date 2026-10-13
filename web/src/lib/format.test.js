import { describe, expect, test } from "vitest";
import { dayLong, dayShort, greeting, greetingName, pct, rub } from "./format";

describe("format", () => {
  test("рубли с пробелами-разделителями", () => {
    expect(rub(12400).replace(/\s/g, " ")).toBe("12 400 ₽");
    expect(rub(null)).toBe("0 ₽");
  });

  test("проценты и пропуски", () => {
    expect(pct(7)).toBe("7%");
    expect(pct(null)).toBe("-");
  });

  test("даты по-русски", () => {
    expect(dayLong("2026-10-14")).toBe("14 октября, среда");
    expect(dayShort("2026-10-14")).toBe("14.10");
  });

  test("обращение по имени и отчеству", () => {
    expect(greetingName("Смирнова Анна Петровна")).toBe("Анна Петровна");
    expect(greetingName("Анна")).toBe("Анна");
    expect(greeting(13)).toBe("Добрый день");
    expect(greeting(8)).toBe("Доброе утро");
  });
});
