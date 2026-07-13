process.env.ADMIN_JWT_SECRET = "test_admin_secret";

jest.mock("bcryptjs", () => ({
  compare: jest.fn(() => Promise.resolve(true)),
  hash: jest.fn(() => Promise.resolve("hash"))
}));

jest.mock("../src/services/employeeReferrals", () => ({
  TZ: "Europe/Moscow",
  buildLink: (code) => `https://t.me/Bytwise_bot?start=emp_${code}`,
  statsForEmployee: jest.fn(() => Promise.resolve({
    clicks: { day: 0, week: 0, month: 0, total: 0 },
    referrals: { confirmed: 0, pending: 0, rejected: 0, paid: 0, unpaid: 0 },
    payments: { total: 0, paid: 0, unpaid: 0, revenue: 0 },
    payouts: { paid_total: 0 }
  })),
  notifyGranted: jest.fn(() => Promise.resolve()),
  notifyPayout: jest.fn(() => Promise.resolve()),
  notifyPayoutCancelled: jest.fn(() => Promise.resolve())
}));

jest.mock("../src/db", () => ({
  query: jest.fn(),
  withTx: jest.fn(),
  logAction: jest.fn(() => Promise.resolve())
}));

const request = require("supertest");
const db = require("../src/db");
const { createApp } = require("../src/app");
const { signAdmin } = require("../src/utils/jwt");

const app = createApp();

const adminUser = {
  id: 1,
  telegram_id: "1001",
  username: "admin",
  name: "Admin",
  email: "admin@example.com",
  is_admin: true,
  is_blocked: false,
  password_hash: "hash",
  totp_enabled: false
};

function mockDb() {
  db.query.mockImplementation(async (text) => {
    const sql = String(text);
    if (sql.includes("FROM admin_login_attempts")) return { rows: [{ c: 0 }] };
    if (sql.includes("INSERT INTO admin_login_attempts")) return { rows: [] };
    if (sql.includes("FROM users u LEFT JOIN admin_credentials")) return { rows: [adminUser] };
    if (sql.includes("SELECT id, telegram_id, username, name, is_admin, is_blocked")) return { rows: [adminUser] };
    if (sql.includes("SELECT totp_enabled FROM admin_credentials")) return { rows: [{ totp_enabled: false }] };
    if (sql.includes("FROM employees e JOIN users u ON u.id = e.user_id") && sql.includes("WHERE e.id = $1")) {
      return { rows: [{ id: 7, user_id: 8, code: "abc", active: true, telegram_id: "2002", name: "Worker", username: "worker" }] };
    }
    if (sql.includes("FROM employees e JOIN users u ON u.id = e.user_id") && sql.includes("ORDER BY e.active DESC")) {
      return { rows: [{ id: 7, code: "abc", active: true, telegram_id: "2002", name: "Worker", username: "worker" }] };
    }
    if (sql.includes("FROM employee_referrals r JOIN users u")) return { rows: [] };
    if (sql.includes("SELECT * FROM employee_payouts")) return { rows: [] };
    if (sql.includes("generate_series")) return { rows: [] };
    return { rows: [] };
  });
  db.logAction.mockClear();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb();
});

describe("admin cookie session", () => {
  test("login sets HttpOnly admin_session cookie", async () => {
    const res = await request(app)
      .post("/api/admin/auth/login")
      .send({ identifier: "admin@example.com", password: "secret" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    const cookie = res.headers["set-cookie"]?.find((c) => c.startsWith("admin_session="));
    expect(cookie).toBeTruthy();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/admin");
    expect(cookie).toContain("SameSite=Lax");
  });

  test("me and employees work with cookie only", async () => {
    const agent = request.agent(app);
    await agent.post("/api/admin/auth/login").send({ identifier: "admin@example.com", password: "secret" }).expect(200);

    const me = await agent.get("/api/admin/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.admin.id).toBe(adminUser.id);

    const list = await agent.get("/api/admin/employees");
    expect(list.status).toBe(200);
    expect(list.body.employees[0].link).toContain("emp_abc");

    const detail = await agent.get("/api/admin/employees/7");
    expect(detail.status).toBe(200);
    expect(detail.body.employee.id).toBe(7);
  });

  test("logout clears cookie and the session stops working", async () => {
    const agent = request.agent(app);
    await agent.post("/api/admin/auth/login").send({ identifier: "admin@example.com", password: "secret" }).expect(200);

    const logout = await agent.post("/api/admin/auth/logout");
    expect(logout.status).toBe(200);
    expect(logout.headers["set-cookie"]?.join(";")).toContain("admin_session=");

    const me = await agent.get("/api/admin/auth/me");
    expect(me.status).toBe(401);
  });

  test("bad cookie returns invalid_token without crashing", async () => {
    const res = await request(app)
      .get("/api/admin/auth/me")
      .set("Cookie", "admin_session=bad-token");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
  });

  test("old Bearer token still works and refreshes into a cookie", async () => {
    const bearer = signAdmin({ uid: adminUser.id });
    const res = await request(app)
      .get("/api/admin/auth/me")
      .set("Authorization", `Bearer ${bearer}`);

    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]?.some((c) => c.startsWith("admin_session="))).toBe(true);
  });

  test("expired cookie is rejected", async () => {
    const expired = signAdmin({ uid: adminUser.id }, "-1s");
    const res = await request(app)
      .get("/api/admin/auth/me")
      .set("Cookie", `admin_session=${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
  });
});
