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
