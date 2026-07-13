const request = require("supertest");
const { createApp } = require("../src/app");

const app = createApp();

describe("GET /api/health", () => {
  test("returns ok status", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("auth protection", () => {
  test("rejects profile without token", async () => {
    const res = await request(app).get("/api/profile");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("no_token");
  });
});

describe("unknown routes", () => {
  test("returns 404", async () => {
    const res = await request(app).get("/api/unknown");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });
});
