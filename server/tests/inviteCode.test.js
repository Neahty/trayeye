const { genInviteCode } = require("../src/utils/refcode");
const userInvites = require("../src/services/userInvites");

// Код пользовательской ссылки-приглашения (Поправка №47). Его диктуют голосом и
// перепечатывают руками, поэтому важны две вещи: отсутствие визуально похожих
// символов и совместимость с парсером /start в services/bot.js.
describe("genInviteCode", () => {
  test("длина по умолчанию — 5 символов", () => {
    expect(genInviteCode()).toHaveLength(5);
    expect(genInviteCode(7)).toHaveLength(7);
  });

  test("в алфавите нет 0/o и 1/l/i — их путают при перепечатке", () => {
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
  test("ссылка без префикса — в этом отличие от сотрудничьей emp_<code>", () => {
    expect(userInvites.buildLink("k7m2q")).toMatch(/^https:\/\/t\.me\/[^?]+\?start=k7m2q$/);
  });
});
