const { genInviteCode } = require("../src/utils/refcode");
const userInvites = require("../src/services/userInvites");

// Код пользовательской ссылки-приглашения (Поправка №47). Его диктуют голосом и
// перепечатывают руками, поэтому важны две вещи: отсутствие визуально похожих
// символов и совместимость с парсером /start в services/bot.js.
describe("genInviteCode", () => {
  test("длина по умолчанию - 5 символов", () => {
    expect(genInviteCode()).toHaveLength(5);
    expect(genInviteCode(7)).toHaveLength(7);
  });

  test("в алфавите нет 0/o и 1/l/i - их путают при перепечатке", () => {
    const codes = Array.from({ length: 500 }, () => genInviteCode(7)).join("");
    expect(codes).not.toMatch(/[01oli]/);
    expect(codes).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]+$/);
  });

  test("совпадает с регексом, по которому /start ловит приглашения", () => {
    // Тот же паттерн, что в services/bot.js: без «_», иначе перехватил бы emp_/tr_.
    const botPattern = /^[a-z0-9]{4,12}$/i;
    for (let len = 5; len <= 7; len++) {
      expect(genInviteCode(len)).toMatch(botPattern);
    }
    expect("emp_a1b2c3d4").not.toMatch(botPattern);
    expect("tr_a1b2c3d4").not.toMatch(botPattern);
  });
});

describe("userInvites.buildLink", () => {
  test("ссылка без префикса - в этом отличие от сотрудничьей emp_<code>", () => {
    expect(userInvites.buildLink("k7m2q")).toMatch(/^https:\/\/t\.me\/[^?]+\?start=k7m2q$/);
  });
});

const { formatRaffle, CMD_RE } = require("../src/services/logModeration");
const { plural } = require("../src/services/inviteRewards");

// Пост «.розыгрыш» копируют в публичный канал как есть, поэтому формат зафиксирован.
describe("formatRaffle", () => {
  const rows = [
    { telegram_id: "6850462093", name: "Мафия", username: "Chel798", invited: 47, confirmed: 39 },
    { telegram_id: "5573329075", name: "Оля", username: "portishkovich", invited: 41, confirmed: 36 },
    { telegram_id: "5684446569", name: "Санек", username: "Sancheslala", invited: 31, confirmed: 30 },
    { telegram_id: "5793374921", name: "Даня Овеню", username: "danyoven1", invited: 26, confirmed: 26 },
    { telegram_id: "7367935232", name: "Даша", username: "cnixix", invited: 33, confirmed: 25 }
  ];

  test("шапка, топ-3, черта и сквозная нумерация хвоста", () => {
    const lines = formatRaffle(rows).split("\n");
    expect(lines[0]).toBe("На данный момент следующие ТОП-5 участников");
    expect(lines[2]).toBe("🔫 Топ-3 (приглашено / зачтено):");
    expect(lines[3]).toBe('1. <a href="https://t.me/Chel798">Мафия</a> · ID <code>6850462093</code> - 47 / 39');
    expect(lines[6]).toBe("_________________________________");
    expect(lines[7]).toMatch(/^4\. /);
    expect(lines[8]).toMatch(/^5\. /);
  });

  test("без черты, когда участников три и меньше", () => {
    const text = formatRaffle(rows.slice(0, 2));
    expect(text).not.toContain("____");
    expect(text).toContain("🔫 Топ-2 (приглашено / зачтено):");
  });

  test("без @username имя идёт без ссылки, спецсимволы экранируются", () => {
    const text = formatRaffle([{ telegram_id: "1", name: "A&B <x>", username: null, invited: 2, confirmed: 1 }]);
    expect(text).not.toContain("<a href");
    expect(text).toContain("A&amp;B &lt;x&gt;");
  });
});

describe("CMD_RE - команды из канала логов", () => {
  test("ловит .розыгрыш с аргументом и без, не задевая обычный текст", () => {
    expect(CMD_RE.exec(".розыгрыш")[1]).toBe("розыгрыш");
    expect(CMD_RE.exec(".розыгрыш 10")[2]).toBe("10");
    expect(CMD_RE.exec(".запретить 123")[1]).toBe("запретить");
    expect(CMD_RE.exec("розыгрыш сегодня")).toBeNull();
  });
});

// Период конкурса задаётся датами, а вся статистика приглашений считается по Москве:
// границы обязаны попадать в московскую полночь, а не в полночь UTC или сервера.
describe("adminInvites.parseRange", () => {
  const { parseRange } = require("../src/routes/adminInvites");

  test("YYYY-MM-DD разворачивается в московские начало и конец суток", () => {
    const { from, to } = parseRange({ from: "2026-07-01", to: "2026-07-31" });
    expect(from.toISOString()).toBe("2026-06-30T21:00:00.000Z"); // 1 июля 00:00 МСК
    expect(to.toISOString()).toBe("2026-07-31T20:59:59.999Z");   // 31 июля 23:59:59 МСК
  });

  test("пустые и мусорные значения дают null - условие в SQL пропускает всё", () => {
    expect(parseRange({}).from).toBeNull();
    expect(parseRange({ from: "", to: "  " }).to).toBeNull();
    expect(parseRange({ from: "не дата" }).from).toBeNull();
  });
});

describe("plural", () => {
  test("склоняет дни по-русски", () => {
    expect(plural(1, "день", "дня", "дней")).toBe("день");
    expect(plural(3, "день", "дня", "дней")).toBe("дня");
    expect(plural(5, "день", "дня", "дней")).toBe("дней");
    expect(plural(11, "день", "дня", "дней")).toBe("дней"); // 11, а не «11 день»
    expect(plural(21, "день", "дня", "дней")).toBe("день");
  });
});
