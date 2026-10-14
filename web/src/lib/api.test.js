import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("appUrl", () => {
  test.each(["/", "/trayeye/"])("учитывает базовый путь %s", async (base) => {
    vi.stubEnv("BASE_URL", base);
    vi.resetModules();
    const { appUrl } = await import("./api");
    const prefix = base.replace(/\/$/, "");
    expect(appUrl("/figma/imgRectangle4273.png")).toBe(`${prefix}/figma/imgRectangle4273.png`);
    expect(appUrl("https://example.com/image.png")).toBe("https://example.com/image.png");
    expect(appUrl("//example.com/image.png")).toBe("//example.com/image.png");
    expect(appUrl(null)).toBeNull();
  });
});

describe("401 и смена сессии", () => {
  function stubBrowser(store) {
    vi.stubGlobal("localStorage", {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k)
    });
    const events = [];
    vi.stubGlobal("window", { dispatchEvent: (e) => events.push(e.type) });
    return events;
  }

  afterEach(() => vi.unstubAllGlobals());

  test("отозванная текущая сессия сбрасывается и выводит из кабинета", async () => {
    const store = new Map([["trayeye_session", "old"]]);
    const events = stubBrowser(store);
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 401, json: async () => ({ error: "link_revoked" }) }));
    const { api, SESSION_LOST } = await import("./api");
    await expect(api.get("/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(store.has("trayeye_session")).toBe(false);
    expect(events).toEqual([SESSION_LOST]);
  });

  test("поздний 401 по старому токену не стирает новый вход", async () => {
    const store = new Map([["trayeye_session", "old"]]);
    const events = stubBrowser(store);
    vi.stubGlobal("fetch", async () => {
      store.set("trayeye_session", "new"); // пока запрос шёл, вошли по другой ссылке
      return { ok: false, status: 401, json: async () => ({ error: "link_revoked" }) };
    });
    const { api } = await import("./api");
    await expect(api.get("/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(store.get("trayeye_session")).toBe("new");
    expect(events).toEqual([]);
  });
});
