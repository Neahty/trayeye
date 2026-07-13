// Генерация и выдача реферального кода (ref_code) пользователю.
// Реф-ссылка есть у тренеров: код выдаётся при покупке тренерской подписки
// и лениво — при запросе ссылки-приглашения, если его почему-то нет.
const crypto = require("crypto");
const db = require("../db");

function genRefCode() {
  return crypto.randomBytes(4).toString("hex"); // 8 символов
}

// Подбирает код, которого ещё нет в users.ref_code (несколько попыток против коллизий).
async function uniqueRefCode() {
  for (let i = 0; i < 5; i++) {
    const code = genRefCode();
    const { rows } = await db.query("SELECT 1 FROM users WHERE ref_code = $1", [code]);
    if (!rows.length) return code;
  }
  return genRefCode() + Date.now().toString(36);
}

// Возвращает ref_code пользователя; если он пустой — генерирует, сохраняет и возвращает.
// Чинит старые аккаунты без кода (источник битых ссылок tr_null).
async function ensureRefCode(userId) {
  const { rows } = await db.query("SELECT ref_code FROM users WHERE id = $1", [userId]);
  const existing = rows[0]?.ref_code;
  if (existing) return existing;
  const code = await uniqueRefCode();
  await db.query("UPDATE users SET ref_code = $2 WHERE id = $1", [userId, code]);
  return code;
}

// Код сотрудника-пиарщика (ссылка emp_<code>): уникален среди employees.code.
async function uniqueEmployeeCode() {
  for (let i = 0; i < 5; i++) {
    const code = genRefCode();
    const { rows } = await db.query("SELECT 1 FROM employees WHERE code = $1", [code]);
    if (!rows.length) return code;
  }
  return genRefCode() + Date.now().toString(36);
}

module.exports = { genRefCode, uniqueRefCode, ensureRefCode, uniqueEmployeeCode };
