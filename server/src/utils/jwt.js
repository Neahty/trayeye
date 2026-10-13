const jwt = require("jsonwebtoken");

// Без секрета токены подписывались бы известной строкой и их можно было бы подделать,
// поэтому фолбэк есть только у тестов (jest сам ставит NODE_ENV=test).
if (!process.env.JWT_SECRET && process.env.NODE_ENV !== "test") {
  throw new Error("JWT_SECRET не задан. Сгенерируй: openssl rand -hex 32");
}

const SECRET = process.env.JWT_SECRET || "test_secret";
const SESSION_TTL = "30d";

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: SESSION_TTL });
}

function verify(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { sign, verify };
