// Личные ссылки входа: комбинат выдаёт их директорам, регистрации нет.
// В базе лежит только sha256 токена, сам токен показывается один раз при создании.

const crypto = require("crypto");

const TOKEN_BYTES = 32;

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function linkUrl(token) {
  const base = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
  return `${base}/l/${token}`;
}

// Создаёт ссылку и возвращает { id, token, url }. q - db или клиент транзакции.
async function createLink(q, { role, kombinatId, directorId = null }) {
  const token = generateToken();
  const { rows } = await q.query(
    `INSERT INTO access_links (role, kombinat_id, director_id, token_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [role, kombinatId, directorId, hashToken(token)]
  );
  return { id: rows[0].id, token, url: linkUrl(token) };
}

// Активная ссылка по токену или null.
async function findActiveLink(q, token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const { rows } = await q.query(
    `SELECT id, role, last_used_at FROM access_links WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

// Демо-ссылка роли (для директора - его школы): берём действующую или заводим новую.
// Токен никому не показывается, вход по ней только через /api/auth/demo. Возвращает id ссылки.
async function demoLink(q, { role, kombinatId, directorId = null }) {
  const { rows } = await q.query(
    `SELECT id FROM access_links
      WHERE is_demo AND revoked_at IS NULL AND role = $1 AND kombinat_id = $2
        AND director_id IS NOT DISTINCT FROM $3
      ORDER BY id LIMIT 1`,
    [role, kombinatId, directorId]
  );
  if (rows[0]) return rows[0].id;
  const created = await q.query(
    `INSERT INTO access_links (role, kombinat_id, director_id, token_hash, is_demo)
     VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
    [role, kombinatId, directorId, hashToken(generateToken())]
  );
  return created.rows[0].id;
}

module.exports = { generateToken, hashToken, linkUrl, createLink, findActiveLink, demoLink };
