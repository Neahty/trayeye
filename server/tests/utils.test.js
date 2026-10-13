const dates = require("../src/utils/dates");
const http = require("../src/utils/http");
const links = require("../src/services/links");

describe("dates", () => {
  test("следующий учебный день пропускает выходные", () => {
    expect(dates.nextSchoolDay("2026-10-13")).toBe("2026-10-14");
    expect(dates.nextSchoolDay("2026-10-16")).toBe("2026-10-19");
  });

  test("предыдущие учебные дни идут по возрастанию и без выходных", () => {
    expect(dates.previousSchoolDays("2026-10-13", 3)).toEqual(["2026-10-08", "2026-10-09", "2026-10-12"]);
  });

  test("день недели и фраза для рекомендаций", () => {
    expect(dates.weekday("2026-10-14")).toBe(3);
    expect(dates.weekdayPhrase("2026-10-13")).toBe("во вторник");
  });

  test("APP_TODAY фиксирует сегодняшнюю дату", () => {
    process.env.APP_TODAY = "2026-10-13";
    expect(dates.today()).toBe("2026-10-13");
    delete process.env.APP_TODAY;
    expect(dates.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("http parsers", () => {
  test("parseDate принимает только существующие даты", () => {
    expect(http.parseDate("2026-10-13")).toBe("2026-10-13");
    expect(http.parseDate("2026-02-30")).toBeNull();
    expect(http.parseDate("13.10.2026")).toBeNull();
    expect(http.parseDate(undefined)).toBeNull();
  });

  test("parseId и parseIntInRange", () => {
    expect(http.parseId("5")).toBe(5);
    expect(http.parseId("0")).toBeNull();
    expect(http.parseId("1.5")).toBeNull();
    expect(http.parseIntInRange("10", 0, 5)).toBeNull();
    expect(http.parseIntInRange(0, 0, 5)).toBe(0);
  });

  test("parseText обрезает пробелы и режет пустое и длинное", () => {
    expect(http.parseText("  Анна  ", 10)).toBe("Анна");
    expect(http.parseText("   ", 10)).toBeNull();
    expect(http.parseText("x".repeat(11), 10)).toBeNull();
    expect(http.parseText(42, 10)).toBeNull();
  });
});

describe("links", () => {
  test("токен длинный, случайный, а хэш стабилен", () => {
    const a = links.generateToken();
    const b = links.generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(links.hashToken(a)).toBe(links.hashToken(a));
    expect(links.hashToken(a)).not.toContain(a);
  });

  test("ссылка строится от PUBLIC_URL без двойного слэша", () => {
    process.env.PUBLIC_URL = "https://trayeye.example/";
    expect(links.linkUrl("abc")).toBe("https://trayeye.example/l/abc");
  });
});
