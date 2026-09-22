// Генерация и выдача реферального кода (ref_code) пользователю.
// Реф-ссылка есть у тренеров: код выдаётся при покупке тренерской подписки
// и лениво - при запросе ссылки-приглашения, если его почему-то нет.
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

// Возвращает ref_code пользователя; если он пустой - генерирует, сохраняет и возвращает.
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

// --- Код пользовательской ссылки-приглашения (users.invite_code) ---
// Отдельно от ref_code: тот 8-символьный hex и уже вшит в тренерские ссылки tr_<ref_code>
// и в POST /api/trainer/clients - менять его формат нельзя. Здесь нужен короткий и
// красивый код: ссылка выглядит как t.me/<бот>?start=k7m2q.

// Алфавит без визуально похожих символов: нет 0/o, 1/l/i - код диктуют голосом и
// перепечатывают руками, поэтому неоднозначность дороже пары лишних комбинаций.
const INVITE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function genInviteCode(len = 5) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return out;
}

// Подбирает свободный код, наращивая длину: 5 символов (≈28 млн вариантов) почти всегда
// хватает, но при росте базы коллизии учащаются - тогда берём 6, затем 7.
async function uniqueInviteCode() {
  for (let len = 5; len <= 7; len++) {
    for (let i = 0; i < 5; i++) {
      const code = genInviteCode(len);
      const { rows } = await db.query("SELECT 1 FROM users WHERE invite_code = $1", [code]);
      if (!rows.length) return code;
    }
  }
  return genInviteCode(7) + Date.now().toString(36);
}

// Возвращает invite_code пользователя; если пустой - генерирует, сохраняет и возвращает.
// Ленивая выдача: у всех аккаунтов, заведённых до Поправки №47, кода нет.
async function ensureInviteCode(userId) {
  const { rows } = await db.query("SELECT invite_code FROM users WHERE id = $1", [userId]);
  const existing = rows[0]?.invite_code;
  if (existing) return existing;
  const code = await uniqueInviteCode();
  await db.query("UPDATE users SET invite_code = $2 WHERE id = $1", [userId, code]);
  return code;
}

module.exports = {
  genRefCode,
  uniqueRefCode,
  ensureRefCode,
  uniqueEmployeeCode,
  genInviteCode,
  uniqueInviteCode,
  ensureInviteCode
};
