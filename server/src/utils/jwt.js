const jwt = require("jsonwebtoken");

// В production секреты ОБЯЗАТЕЛЬНЫ: иначе токены подписываются предсказуемым фолбэком
// ("dev_secret") и их можно подделать. Падаем на старте, чтобы не уехать в бой без секрета.
if (process.env.NODE_ENV === "production") {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET не задан (обязателен в production)");
  if (!process.env.ADMIN_JWT_SECRET) throw new Error("ADMIN_JWT_SECRET не задан (обязателен в production)");
}

const SECRET = process.env.JWT_SECRET || "dev_secret";
const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || SECRET + "_admin";

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: "30d" });
}

function verify(token) {
  const decoded = jwt.verify(token, SECRET);
  // Сессионный токен подписывается без scope: токены других назначений
  // (например admin) подписаны иначе и сессией работать не должны.
  if (decoded.scope) throw new Error("wrong_scope");
  return decoded;
}

// Отдельный токен для админ-панели. Срок 12 ч, но middleware adminAuth «скользяще»
// перевыпускает его на активности (см. X-Admin-Token), поэтому за работой админа не выкидывает,
// а простаивающая сессия всё равно истекает.
function signAdmin(payload, expiresIn = "24h") {
  return jwt.sign({ ...payload, scope: "admin" }, ADMIN_SECRET, { expiresIn });
}

function verifyAdmin(token) {
  const decoded = jwt.verify(token, ADMIN_SECRET);
  if (decoded.scope !== "admin") throw new Error("not_admin_scope");
  return decoded;
}

module.exports = { sign, verify, signAdmin, verifyAdmin };
