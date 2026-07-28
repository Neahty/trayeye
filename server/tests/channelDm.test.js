const { CMD_RE, DM_RE } = require("../src/services/logModeration");

// Разбор текста поста в канале логов: одна и та же точка запускает и команды модерации,
// и личное сообщение человеку. Команды всегда в приоритете — эту границу и фиксируем.
describe("DM_RE — «.текст» как личное сообщение", () => {
  // Так же, как в onChannelPost: сначала CMD_RE, и только если не совпало — DM_RE.
  const parse = (text) => (CMD_RE.test(text) ? { cmd: CMD_RE.exec(text)[1].toLowerCase() } : (
    DM_RE.test(text) ? { dm: DM_RE.exec(text)[1] } : null
  ));

  test("команды остаются командами, а не текстом для человека", () => {
    expect(parse(".запретить")).toEqual({ cmd: "запретить" });
    expect(parse(".разрешить 123")).toEqual({ cmd: "разрешить" });
    expect(parse(".баны")).toEqual({ cmd: "баны" });
    expect(parse(".розыгрыш 10")).toEqual({ cmd: "розыгрыш" });
  });

  test("обычный текст с точки уходит в личное сообщение без самой точки", () => {
    expect(parse(".Привет")).toEqual({ dm: "Привет" });
    expect(parse(".Привет, как дела?")).toEqual({ dm: "Привет, как дела?" });
    expect(parse(" .Привет  ")).toEqual({ dm: "Привет" });
  });

  test("многострочное сообщение сохраняется целиком", () => {
    expect(parse(".Первая строка\n\nВторая строка")).toEqual({ dm: "Первая строка\n\nВторая строка" });
  });

  test("текст без точки в начале не трогаем — в канале пишут и обычные посты", () => {
    expect(parse("Привет")).toBeNull();
    expect(parse("Итого 5.4 кг")).toBeNull();
  });

  test("одна точка и точка с пробелом ничего не запускают", () => {
    expect(parse(".")).toBeNull();
    expect(parse(". ")).toBeNull();
    expect(parse(". Привет")).toBeNull();
  });
});
