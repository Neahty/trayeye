const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 20
});

pool.on("error", (err) => {
  console.error("[db] unexpected pool error:", err.message);
});

function query(text, params) {
  return pool.query(text, params);
}

// Выполняет fn внутри транзакции: BEGIN -> fn(client) -> COMMIT, при ошибке ROLLBACK.
// fn получает выделенного клиента; все запросы внутри должны идти через него (client.query),
// иначе они не попадут в транзакцию. Клиент всегда освобождается.
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* соединение могло отвалиться */ }
    throw err;
  } finally {
    client.release();
  }
}

function getAdminIds() {
  return (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Применяет schema.sql и проставляет админов из ADMIN_TELEGRAM_IDS
async function init() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);

  const adminIds = getAdminIds();
  if (adminIds.length) {
    for (const tid of adminIds) {
      await pool.query(
        `INSERT INTO users (telegram_id, name, is_admin)
         VALUES ($1, 'Admin', TRUE)
         ON CONFLICT (telegram_id) DO UPDATE SET is_admin = TRUE`,
        [tid]
      );
    }
  }
  console.log("[db] schema applied, admins synced:", adminIds.join(", ") || "-");

  await bootstrapAdminCredentials(adminIds);
}

// Создаёт запись admin_credentials с паролем из ADMIN_BOOTSTRAP_PASSWORD
// для существующих админов, у которых пароля ещё нет.
async function bootstrapAdminCredentials(adminIds) {
  const bootstrapPwd = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!bootstrapPwd || !adminIds.length) return;
  let bcrypt;
  try {
    bcrypt = require("bcryptjs");
  } catch {
    console.warn("[db] bcryptjs не установлен - пропускаю bootstrap пароля админа");
    return;
  }
  const hash = await bcrypt.hash(bootstrapPwd, 12);
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE telegram_id = ANY($1::bigint[]) AND is_admin = TRUE`,
    [adminIds]
  );
  for (const r of rows) {
    await pool.query(
      `INSERT INTO admin_credentials (user_id, password_hash, password_changed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [r.id, hash]
    );
  }
  console.log(`[db] admin credentials bootstrap: ${rows.length} admin(s)`);
}

// Логирование действий в system_logs
async function logAction(userId, action, details = {}) {
  try {
    await pool.query(
      `INSERT INTO system_logs (user_id, action, details) VALUES ($1, $2, $3)`,
      [userId || null, action, details]
    );
  } catch (err) {
    console.error("[db] logAction failed:", err.message);
  }
}

module.exports = { pool, query, withTx, init, logAction, getAdminIds };
