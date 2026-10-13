// Интеграционные тесты API на настоящем Postgres (TEST_DATABASE_URL).
// Без TEST_DATABASE_URL набор пропускается.
const fs = require("fs");
const os = require("os");
const path = require("path");

require("../src/env");
const TEST_DB = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = TEST_DB;
process.env.APP_TODAY = "2026-10-13";
process.env.PUBLIC_URL = "http://test.local";
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "trayeye-uploads-"));
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_API_KEYS;
delete process.env.OPENAI_API_KEY;

const request = require("supertest");
const db = require("../src/db");
const { seed } = require("../src/db/seed");
const { createLink } = require("../src/services/links");
const vision = require("../src/services/vision");
const { createApp } = require("../src/app");

const suite = TEST_DB ? describe : describe.skip;
const tokenOf = (url) => url.split("/l/")[1];

suite("API", () => {
  const app = createApp();
  let links;

  async function login(linkToken) {
    const res = await request(app).post("/api/auth/link").send({ token: linkToken });
    expect(res.status).toBe(200);
    return res.body.token;
  }

  const get = (url, token) => request(app).get(url).set("Authorization", `Bearer ${token}`);
  const send = (method, url, token, body) => request(app)[method](url).set("Authorization", `Bearer ${token}`).send(body);

  beforeAll(async () => {
    await db.migrate();
    const result = await db.withTx((client) => seed(client, { today: "2026-10-13", scale: 0.05 }));
    links = result.links;
  }, 60000);

  afterAll(async () => {
    await db.pool.end();
    fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
  });

  test("BASE_PATH: приложение отвечает под префиксом прокси", async () => {
    process.env.BASE_PATH = "/trayeye";
    const prefixed = createApp();
    delete process.env.BASE_PATH;
    expect((await request(prefixed).get("/trayeye/api/health")).body).toEqual({ status: "ok" });
    expect((await request(prefixed).get("/api/health")).status).toBe(404);
  });

  test("health проверяет базу", async () => {
    const res = await request(app).get("/api/health");
    expect(res.body).toEqual({ status: "ok" });
  });

  describe("вход по ссылке", () => {
    test("неизвестная ссылка - 401", async () => {
      const res = await request(app).post("/api/auth/link").send({ token: "x".repeat(43) });
      expect(res.status).toBe(401);
    });

    test("без токена и с битым токеном - 401", async () => {
      expect((await request(app).get("/api/auth/me")).status).toBe(401);
      expect((await get("/api/auth/me", "garbage")).status).toBe(401);
    });

    test("директор видит свой профиль и не пускается к комбинату", async () => {
      const token = await login(tokenOf(links.directors[0].url));
      const me = await get("/api/auth/me", token);
      expect(me.body.cabinet).toMatchObject({ role: "director", schoolNumber: 33, fullName: "Смирнова Анна Петровна" });
      expect((await get("/api/kombinat/dashboard", token)).status).toBe(403);
    });

    test("комбинат не пускается в кабинет директора", async () => {
      const token = await login(tokenOf(links.kombinat));
      expect((await get("/api/director/dashboard", token)).status).toBe(403);
    });
  });

  describe("кабинет директора", () => {
    let token;
    beforeAll(async () => {
      token = await login(tokenOf(links.directors[0].url));
    });

    test("главная: карточки, прогноз на следующий учебный день, рекомендации", async () => {
      const res = await get("/api/director/dashboard", token);
      expect(res.status).toBe(200);
      expect(res.body.school.number).toBe(33);
      expect(res.body.date).toBe("2026-10-13");
      expect(res.body.cards.waste.pct).toBeLessThan(res.body.cards.waste.baselinePct);
      expect(res.body.cards.kids.students).toBeGreaterThan(0);
      expect(res.body.forecast.date).toBe("2026-10-14");
      expect(res.body.forecast.items.map((i) => i.name)).toEqual(["Борщ", "Котлеты", "Пюре", "Салат", "Компот"]);
      expect(Array.isArray(res.body.recommendations)).toBe(true);
    });

    test("неверная дата - 400", async () => {
      expect((await get("/api/director/dashboard?date=2026-13-01", token)).status).toBe(400);
      expect((await get("/api/director/stats?from=2026-10-10&to=2026-10-01", token)).status).toBe(400);
    });

    test("меню: добавить своё блюдо, нельзя чужое, удалить", async () => {
      const dishes = (await get("/api/director/dishes", token)).body.dishes;
      const plov = dishes.find((d) => d.name === "Плов");

      const created = await send("post", "/api/director/menu", token, { date: "2026-10-15", dish_id: plov.id, planned_portions: 40 });
      expect(created.status).toBe(201);

      const menu = await get("/api/director/menu?date=2026-10-15", token);
      expect(menu.body.items).toEqual([expect.objectContaining({ name: "Плов", planned: 40, eatenPct: null })]);

      const other = await db.query("INSERT INTO kombinats (name) VALUES ('Чужой') RETURNING id");
      const foreign = await db.query(
        "INSERT INTO dishes (kombinat_id, name, portion_grams, portion_price) VALUES ($1, 'Чужое блюдо', 100, 10) RETURNING id",
        [other.rows[0].id]
      );
      const denied = await send("post", "/api/director/menu", token, { date: "2026-10-15", dish_id: foreign.rows[0].id, planned_portions: 1 });
      expect(denied.status).toBe(404);

      expect((await send("delete", `/api/director/menu/${created.body.item.id}`, token)).status).toBe(200);
      expect((await get("/api/director/menu?date=2026-10-15", token)).body.items).toEqual([]);
    });

    test("применить прогноз переписывает заказ на завтра", async () => {
      const before = (await get("/api/director/dashboard", token)).body.forecast.items;
      const res = await send("post", "/api/director/forecast/apply", token);
      expect(res.body).toEqual({ date: "2026-10-14", updated: 5 });
      const menu = (await get("/api/director/menu?date=2026-10-14", token)).body.items;
      for (const f of before) expect(menu.find((m) => m.dish_id === f.dish_id).planned).toBe(f.forecast);
    });

    test("посещаемость класса: нельзя больше, чем учеников", async () => {
      const classes = (await get("/api/director/classes", token)).body.classes;
      const cls = classes[0];
      const tooMany = await send("put", `/api/director/classes/${cls.id}/attendance`, token, { date: "2026-10-13", present_count: cls.students_count + 1 });
      expect(tooMany.status).toBe(400);
      const ok = await send("put", `/api/director/classes/${cls.id}/attendance`, token, { date: "2026-10-13", present_count: cls.students_count });
      expect(ok.status).toBe(200);
    });

    test("статистика за период", async () => {
      const res = await get("/api/director/stats?from=2026-10-01&to=2026-10-13", token);
      expect(res.status).toBe(200);
      expect(res.body.series.length).toBe(9);
      expect(res.body.dishes.length).toBeGreaterThan(0);
    });

    test("фото подноса без ключей ИИ - 503", async () => {
      const res = await request(app).post("/api/director/tray")
        .set("Authorization", `Bearer ${token}`)
        .attach("image", Buffer.from("fake"), { filename: "t.jpg", contentType: "image/jpeg" });
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("ai_not_configured");
    });

    test("фото подноса: результат ИИ сохраняется в статистику", async () => {
      const menu = (await get("/api/director/menu", token)).body.items;
      const spy = jest.spyOn(vision, "analyzeTray").mockResolvedValue({
        items: [{ dish_id: menu[0].dish_id, leftover_pct: 25 }], model: "test-model"
      });
      const res = await request(app).post("/api/director/tray")
        .set("Authorization", `Bearer ${token}`)
        .attach("image", Buffer.from("fake"), { filename: "t.png", contentType: "image/png" });
      spy.mockRestore();
      expect(res.status).toBe(201);
      expect(res.body.items).toEqual([{ dish_id: menu[0].dish_id, leftover_pct: 25, name: menu[0].name }]);
      expect(fs.existsSync(path.join(process.env.UPLOADS_DIR, res.body.scan.photo_path))).toBe(true);

      // Фото не раздаётся публично, только своей школе через API.
      expect((await request(app).get(`/api/uploads/${res.body.scan.photo_path}`)).status).toBe(404);
      expect((await request(app).get(`/api/director/tray/${res.body.scan.id}/photo`)).status).toBe(401);
      const photo = await get(`/api/director/tray/${res.body.scan.id}/photo`, token);
      expect(photo.status).toBe(200);
      expect(photo.headers["content-type"]).toBe("image/png");

      const other = await login(tokenOf(links.directors[1].url));
      expect((await get(`/api/director/tray/${res.body.scan.id}/photo`, other)).status).toBe(404);
    });

    test("не картинка - 400", async () => {
      const res = await request(app).post("/api/director/tray")
        .set("Authorization", `Bearer ${token}`)
        .attach("image", Buffer.from("<html>"), { filename: "x.html", contentType: "text/html" });
      expect(res.status).toBe(400);
    });
  });

  describe("кабинет комбината", () => {
    let token;
    beforeAll(async () => {
      token = await login(tokenOf(links.kombinat));
    });

    test("главная: все школы и итоги", async () => {
      const res = await get("/api/kombinat/dashboard", token);
      expect(res.body.kombinat.name).toBe("Полиграф комбинат");
      expect(res.body.schools.map((s) => s.number)).toEqual([11, 21, 33]);
      expect(res.body.totals.schools).toBe(3);
    });

    test("меню товаров: порции, вес, школы и поставщик", async () => {
      const res = await get("/api/kombinat/products?date=2026-10-14", token);
      const borscht = res.body.products.find((p) => p.name === "Борщ");
      expect(borscht.school_numbers).toEqual([11, 21, 33]);
      expect(borscht.supplier_name).toBe("ООО «Овощная база»");
      expect(borscht.weightKg).toBeCloseTo((borscht.portions * 250) / 1000, 1);
    });

    test("личная ссылка: новый директор входит и видит только свою школу; отзыв закрывает доступ", async () => {
      const created = await send("post", "/api/kombinat/links", token, { full_name: "Иванов Иван Иванович", school_number: 45 });
      expect(created.status).toBe(201);
      expect(created.body.link.url).toMatch(/^http:\/\/test\.local\/l\//);
      expect(created.body.school.name).toBe("Школа №45");

      const dirToken = await login(tokenOf(created.body.link.url));
      const dash = await get("/api/director/dashboard", dirToken);
      expect(dash.body.school.number).toBe(45);
      expect(dash.body.cards.kids.students).toBe(0);

      expect((await send("delete", `/api/kombinat/links/${created.body.link.id}`, token)).status).toBe(200);
      expect((await get("/api/director/dashboard", dirToken)).status).toBe(401);
    });

    test("неполные данные для ссылки - 400", async () => {
      expect((await send("post", "/api/kombinat/links", token, { full_name: "", school_number: 5 })).status).toBe(400);
      expect((await send("post", "/api/kombinat/links", token, { full_name: "А", school_number: "abc" })).status).toBe(400);
    });

    test("нельзя отозвать свою ссылку и чужую", async () => {
      const own = (await get("/api/auth/me", token)).body.cabinet.linkId;
      expect((await send("delete", `/api/kombinat/links/${own}`, token)).status).toBe(400);

      const other = await db.query("INSERT INTO kombinats (name) VALUES ('Другой') RETURNING id");
      const foreign = await createLink(db, { role: "kombinat", kombinatId: other.rows[0].id });
      expect((await send("delete", `/api/kombinat/links/${foreign.id}`, token)).status).toBe(404);
    });

    test("блюда и поставщики: добавить, дубль - 409, чужой поставщик - 400", async () => {
      const sup = await send("post", "/api/kombinat/suppliers", token, { name: "ООО «Новый»" });
      expect(sup.status).toBe(201);
      expect((await send("post", "/api/kombinat/suppliers", token, { name: "ООО «Новый»" })).status).toBe(409);

      const dish = { name: "Сырники", category: "main", portion_grams: 120, portion_price: 55, supplier_id: sup.body.id };
      expect((await send("post", "/api/kombinat/dishes", token, dish)).status).toBe(201);
      expect((await send("post", "/api/kombinat/dishes", token, dish)).status).toBe(409);

      const other = await db.query("INSERT INTO kombinats (name) VALUES ('Третий') RETURNING id");
      const foreignSup = await db.query("INSERT INTO suppliers (kombinat_id, name) VALUES ($1, 'Чужой') RETURNING id", [other.rows[0].id]);
      const bad = await send("post", "/api/kombinat/dishes", token, { ...dish, name: "Оладьи", supplier_id: foreignSup.rows[0].id });
      expect(bad.status).toBe(400);
      expect((await send("post", "/api/kombinat/dishes", token, { ...dish, name: "Ссылка", image_url: "javascript:alert(1)" })).status).toBe(400);
    });

    test("статистика по школам", async () => {
      const res = await get("/api/kombinat/stats?from=2026-10-01&to=2026-10-13", token);
      expect(res.status).toBe(200);
      expect(res.body.schools.length).toBeGreaterThanOrEqual(3);
      expect(res.body.summary.plannedRub).toBeGreaterThan(0);
    });
  });
});
