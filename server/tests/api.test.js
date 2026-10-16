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
process.env.TELEGRAM_BOT_USERNAME = "TrayEye_bot";
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_API_KEYS;
delete process.env.OPENAI_API_KEY;

const request = require("supertest");
const db = require("../src/db");
const { seed } = require("../src/db/seed");
const { createLink } = require("../src/services/links");
const vision = require("../src/services/vision");
const camera = require("../src/services/camera");
const telegram = require("../src/services/telegram");
const events = require("../src/services/events");
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

  test("CSP: только свои скрипты, без встраивания в чужие сайты", async () => {
    const csp = (await request(app).get("/api/health")).headers["content-security-policy"];
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
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

    test("утром до первых сканов списания не считаются стопроцентными", async () => {
      // На 14.10 меню уже есть, а камера ещё ничего не сняла.
      const res = await get("/api/director/dashboard?date=2026-10-14", token);
      expect(res.status).toBe(200);
      expect(res.body.cards.waste.pct).toBeNull();
      expect(res.body.cards.waste.rub).toBe(0);
      expect(res.body.cards.savings.rub).toBe(0);
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
      for (const empty of [null, "", true]) {
        const res = await send("put", `/api/director/classes/${cls.id}/attendance`, token, { date: "2026-10-13", present_count: empty });
        expect(res.status).toBe(400);
      }
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

    test("видео с камеры: пустой поднос без ИИ, поднос с остатками - в ИИ", async () => {
      const menu = (await get("/api/director/menu", token)).body.items;
      const crop = Buffer.from("jpeg").toString("base64");
      const camSpy = jest.spyOn(camera, "analyzeVideo").mockImplementation(async (videoPath) => {
        expect(fs.existsSync(videoPath)).toBe(true);
        return {
          frames: 30,
          ms_per_frame: 60,
          trays: [
            { is_empty: true, items: [{ kind: "plate", food_share: 0, leftover_pct: 0 }], crop_jpeg: crop },
            { is_empty: false, items: [{ kind: "plate", food_share: 0.3, leftover_pct: 55 }], crop_jpeg: crop }
          ]
        };
      });
      const aiSpy = jest.spyOn(vision, "analyzeTrays").mockImplementation(async ({ images }) => ({
        results: images.map(() => [{ dish_id: menu[0].dish_id, leftover_pct: 40 }]), model: "test-model"
      }));
      const res = await request(app).post("/api/director/camera/video")
        .set("Authorization", `Bearer ${token}`)
        .attach("video", Buffer.from("fake"), { filename: "belt.mp4", contentType: "video/mp4" });
      const aiCalls = aiSpy.mock.calls.length;  // mockRestore() обнуляет счётчик
      camSpy.mockRestore();
      aiSpy.mockRestore();

      expect(res.status).toBe(201);
      expect(aiCalls).toBe(1);
      expect(res.body.stats).toMatchObject({ trays: 2, skipped_ai: 1, sent_to_ai: 1, ai_requests: 1, failed: 0 });
      // Пустой поднос: все блюда дня съедены.
      expect(res.body.trays[0].items.map((it) => it.leftover_pct)).toEqual(menu.map(() => 0));
      expect(res.body.trays[1].items).toEqual([{ dish_id: menu[0].dish_id, leftover_pct: 40, name: menu[0].name }]);
      // Видео удалено сразу после разбора.
      expect(fs.readdirSync(path.join(process.env.UPLOADS_DIR, "camera-inbox"))).toEqual([]);

      const { rows } = await db.query(
        "SELECT source, ai_model FROM tray_scans WHERE id = ANY($1) ORDER BY id",
        [res.body.trays.map((t) => t.scan_id)]
      );
      expect(rows).toEqual([
        { source: "camera", ai_model: camera.LOCAL_MODEL },
        { source: "camera", ai_model: "test-model" }
      ]);
      const photo = await get(`/api/director/tray/${res.body.trays[1].scan_id}/photo`, token);
      expect(photo.status).toBe(200);
    });

    test("видео: сервис камеры не запущен - 503", async () => {
      // Порт 9 закрыт: на сервере настоящий trayeye-vision слушает 4110, тест его не трогает.
      process.env.CAMERA_VISION_URL = "http://127.0.0.1:9";
      const res = await request(app).post("/api/director/camera/video")
        .set("Authorization", `Bearer ${token}`)
        .attach("video", Buffer.from("fake"), { filename: "belt.mp4", contentType: "video/mp4" });
      delete process.env.CAMERA_VISION_URL;
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("camera_unavailable");
    });

    test("Telegram: код для себя и для повара, привязка, список, отвязка", async () => {
      const me = await send("post", "/api/director/telegram/code", token, { role: "director" });
      expect(me.status).toBe(201);
      expect(me.body.code).toMatch(/^[A-Z2-9]{6}$/);
      expect(me.body.url).toBe(`https://t.me/TrayEye_bot?start=${me.body.code}`);
      const cook = await send("post", "/api/director/telegram/code", token, { role: "cook" });
      expect(cook.status).toBe(201);
      expect((await send("post", "/api/director/telegram/code", token, { role: "kombinat" })).status).toBe(400);

      // Код вводят в боте: с дефисом и строчными тоже подходит, второй раз - уже нет.
      const typed = `${me.body.code.slice(0, 3)}-${me.body.code.slice(3)}`.toLowerCase();
      const chat = await telegram.redeemCode(telegram.normalizeCode(typed), { chatId: 900001, name: "Анна" });
      expect(chat).toMatchObject({ role: "director", tg_name: "Анна" });
      expect(chat.school_name).toBeTruthy();
      expect(await telegram.redeemCode(me.body.code, { chatId: 900003 })).toBeNull();
      expect((await telegram.redeemCode(cook.body.code, { chatId: 900002, name: "Повар" })).role).toBe("cook");

      const list = await get("/api/director/telegram", token);
      expect(list.body.bot).toBe("TrayEye_bot");
      expect(list.body.chats.map((c) => [c.chat_id, c.role])).toEqual([["900001", "director"], ["900002", "cook"]]);

      // Чужой директор не видит и не отвязывает чаты этой школы.
      const other = await login(tokenOf(links.directors[1].url));
      expect((await get("/api/director/telegram", other)).body.chats).toEqual([]);
      expect((await send("delete", "/api/director/telegram/900002", other)).status).toBe(404);

      expect((await send("delete", "/api/director/telegram/900002", token)).status).toBe(204);
      expect((await get("/api/director/telegram", token)).body.chats).toHaveLength(1);
      await telegram.unlinkSelf(900001);
    });

    test("Telegram: истёкший код не подходит", async () => {
      const res = await send("post", "/api/director/telegram/code", token, { role: "cook" });
      await db.query("UPDATE tg_codes SET expires_at = NOW() - INTERVAL '1 minute' WHERE code_hash = $1",
        [require("../src/services/links").hashToken(res.body.code)]);
      expect(await telegram.redeemCode(res.body.code, { chatId: 900004 })).toBeNull();
    });

    test("Telegram: в бот приходят только новые уведомления своей школы", async () => {
      const res = await send("post", "/api/director/telegram/code", token, { role: "director" });
      const chat = await telegram.redeemCode(res.body.code, { chatId: 900005 });
      // Привязались - старые события не присылаем.
      expect(await telegram.takeNewEvents(chat)).toEqual([]);
      const other = (await db.query("SELECT id FROM schools WHERE id <> $1 AND kombinat_id = $2 LIMIT 1",
        [chat.school_id, chat.kombinat_id])).rows[0];
      await events.record(db, { kombinatId: chat.kombinat_id, schoolId: chat.school_id, audience: "director", kind: "tg_test", text: "своей школе", link: "/director/menu" });
      await events.record(db, { kombinatId: chat.kombinat_id, schoolId: other.id, audience: "director", kind: "tg_test", text: "чужой школе", link: "/director/menu" });
      await events.record(db, { kombinatId: chat.kombinat_id, audience: "kombinat", kind: "tg_test", text: "комбинату", link: "/kombinat/schools" });
      const fresh = await telegram.chatInfo(db, 900005);
      expect((await telegram.takeNewEvents(fresh)).map((e) => e.text)).toEqual(["своей школе"]);
      expect(await telegram.takeNewEvents(await telegram.chatInfo(db, 900005))).toEqual([]);
      await telegram.unlinkSelf(900005);
      // Чужие тестовые события не должны попадать в проверки ленты ниже.
      await db.query("DELETE FROM events WHERE kind = 'tg_test'");
    });

    test("видео: не видео - 400, без входа - 401", async () => {
      const bad = await request(app).post("/api/director/camera/video")
        .set("Authorization", `Bearer ${token}`)
        .attach("video", Buffer.from("<html>"), { filename: "x.html", contentType: "text/html" });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe("unsupported_video_type");
      const anon = await request(app).post("/api/director/camera/video")
        .attach("video", Buffer.from("fake"), { filename: "belt.mp4", contentType: "video/mp4" });
      expect(anon.status).toBe(401);
    });
  });

  describe("кабинет комбината", () => {
    let token;
    beforeAll(async () => {
      token = await login(tokenOf(links.kombinat));
    });

    test("Telegram: код комбината и его чаты", async () => {
      const res = await send("post", "/api/kombinat/telegram/code", token, {});
      expect(res.status).toBe(201);
      expect(res.body.role).toBe("kombinat");
      const chat = await telegram.redeemCode(res.body.code, { chatId: 900010, name: "Комбинат" });
      expect(chat).toMatchObject({ role: "kombinat", school_id: null });
      expect(chat.kombinat_name).toBe("Полиграф комбинат");
      expect((await get("/api/kombinat/telegram", token)).body.chats.map((c) => c.chat_id)).toEqual(["900010"]);
      expect((await send("delete", "/api/kombinat/telegram/900010", token)).status).toBe(204);
    });

    test("главная: все школы и итоги", async () => {
      const res = await get("/api/kombinat/dashboard", token);
      expect(res.body.kombinat.name).toBe("Полиграф комбинат");
      expect(res.body.schools.map((s) => s.number)).toEqual([11, 21, 33]);
      expect(res.body.totals.schools).toBe(3);
      expect(typeof res.body.totals.wastePct).toBe("number");
      const morning = await get("/api/kombinat/dashboard?date=2026-10-14", token);
      expect(morning.body.totals.wastePct).toBeNull();
      expect(morning.body.totals.baselinePct).toBeGreaterThan(0);
      expect(typeof res.body.totals.baselinePct).toBe("number");
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

    test("карточка школы: сводка и статистика своей школы, чужая - 404", async () => {
      const schools = (await get("/api/kombinat/schools", token)).body.schools;
      const s33 = schools.find((s) => s.number === 33);
      const res = await get(`/api/kombinat/schools/${s33.id}?from=2026-10-01&to=2026-10-13`, token);
      expect(res.status).toBe(200);
      expect(res.body.school).toEqual(expect.objectContaining({ id: s33.id, number: 33 }));
      expect(res.body.cards.kids.students).toBeGreaterThan(0);
      expect(res.body.forecast.items.length).toBeGreaterThan(0);
      expect(res.body.stats.dishes.length).toBeGreaterThan(0);
      expect(res.body.stats.from).toBe("2026-10-01");

      const other = await db.query("INSERT INTO kombinats (name) VALUES ('Четвёртый') RETURNING id");
      const foreign = await db.query("INSERT INTO schools (kombinat_id, number, name) VALUES ($1, 500, 'Чужая') RETURNING id", [other.rows[0].id]);
      expect((await get(`/api/kombinat/schools/${foreign.rows[0].id}`, token)).status).toBe(404);
      expect((await get("/api/kombinat/schools/abc", token)).status).toBe(400);
    });

    test("статистика по школам", async () => {
      const res = await get("/api/kombinat/stats?from=2026-10-01&to=2026-10-13", token);
      expect(res.status).toBe(200);
      expect(res.body.schools.length).toBeGreaterThanOrEqual(3);
      expect(res.body.summary.plannedRub).toBeGreaterThan(0);
      expect(res.body.summary.eatenPct).toBeGreaterThan(0);
      expect(typeof res.body.summary.savingsRub).toBe("number");
      expect(res.body.schools[0].eatenPct).toBeGreaterThan(0);
    });
  });
  describe("уведомления", () => {
    let director, otherDirector, kombinat;
    beforeAll(async () => {
      director = await login(tokenOf(links.directors[0].url));
      otherDirector = await login(tokenOf(links.directors[1].url));
      kombinat = await login(tokenOf(links.kombinat));
    });

    test("демо-лента: комбинат видит меню школ, директор - новое в каталоге", async () => {
      const k = (await get("/api/kombinat/notifications", kombinat)).body.events;
      expect(k.length).toBeGreaterThanOrEqual(3);
      expect(k.every((e) => e.link.startsWith("/kombinat/"))).toBe(true);
      const d = (await get("/api/director/notifications", director)).body.events;
      expect(d.every((e) => e.link.startsWith("/director/"))).toBe(true);
      expect(d.some((e) => e.kind === "dish_added")).toBe(true);
    });

    test("блюдо в меню школы приходит комбинату со ссылкой на день и блюдо", async () => {
      const dish = (await get("/api/director/dishes", director)).body.dishes.find((x) => x.name === "Плов");
      await send("post", "/api/director/menu", director, { date: "2026-10-16", dish_id: dish.id, planned_portions: 12 });
      const [last] = (await get("/api/kombinat/notifications", kombinat)).body.events;
      expect(last.kind).toBe("menu_added");
      expect(last.text).toContain("Гимназия №33: в меню на 16 октября добавили «Плов», 12 порц.");
      expect(last.text).toContain("«Плов»");
      expect(last.link).toBe(`/kombinat/products?date=2026-10-16&focus=dish-${dish.id}`);
      // Директорам события комбината не показываются.
      expect((await get("/api/director/notifications", otherDirector)).body.events.some((e) => e.kind === "menu_added")).toBe(false);
    });

    test("новое блюдо в каталоге видят все директора комбината, но не чужого", async () => {
      const created = await send("post", "/api/kombinat/dishes", kombinat, { name: "Ленивые голубцы", category: "main", portion_grams: 200, portion_price: 70 });
      expect(created.status).toBe(201);
      for (const t of [director, otherDirector]) {
        const [last] = (await get("/api/director/notifications", t)).body.events;
        expect(last).toEqual(expect.objectContaining({ kind: "dish_added", link: `/director/menu?add=${created.body.id}` }));
      }
      const other = await db.query("INSERT INTO kombinats (name) VALUES ('Соседний') RETURNING id");
      const foreignLink = await createLink(db, { role: "kombinat", kombinatId: other.rows[0].id });
      const foreign = await login(foreignLink.token);
      expect((await get("/api/kombinat/notifications", foreign)).body.events).toEqual([]);
    });

    test("первый вход директора по новой ссылке виден комбинату, повторный - нет", async () => {
      const created = await send("post", "/api/kombinat/links", kombinat, { full_name: "Петров Пётр", school_number: 77 });
      await login(tokenOf(created.body.link.url));
      await login(tokenOf(created.body.link.url));
      const joined = (await get("/api/kombinat/notifications", kombinat)).body.events
        .filter((e) => e.kind === "director_joined" && e.text.includes("№77"));
      expect(joined).toHaveLength(1);
      expect(joined[0].text).toContain("Петров Пётр");
      expect(joined[0].link).toBe(`/kombinat/schools?focus=school-${created.body.school.id}`);
    });

    test("«Отправить в комбинат»: отчёт приходит комбинату со ссылкой на школу", async () => {
      const me = (await get("/api/auth/me", director)).body.cabinet;
      expect((await send("post", "/api/director/reports", director, { type: "stats", from: "2026-10-01", to: "2026-10-13" })).status).toBe(201);
      const [last] = (await get("/api/kombinat/notifications", kombinat)).body.events;
      expect(last).toEqual(expect.objectContaining({ kind: "report", link: `/kombinat/schools/${me.schoolId}?from=2026-10-01&to=2026-10-13` }));
      expect(last.text).toContain("Гимназия №33: отчёт за период 1 октября - 13 октября");
      expect((await send("post", "/api/director/reports", director, { type: "attendance", date: "2026-10-13" })).status).toBe(201);
      for (const bad of [{}, { type: "other" }, { type: "attendance", date: "вчера" }, { type: "stats", from: "2026-10-13", to: "2026-10-01" }]) {
        expect((await send("post", "/api/director/reports", director, bad)).status).toBe(400);
      }
    });

    test("без входа и с чужой ролью - нельзя", async () => {
      expect((await request(app).get("/api/director/notifications")).status).toBe(401);
      expect((await get("/api/kombinat/notifications", director)).status).toBe(403);
    });
  });
});
