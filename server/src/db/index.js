const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");

// DATE отдаём строкой YYYY-MM-DD как есть: иначе pg превращает её в Date в поясе процесса
// и дата учебного дня может съехать на сутки.
const PG_DATE_OID = 1082;
types.setTypeParser(PG_DATE_OID, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 10
});

pool.on("error", (err) => {
  console.error("[db] unexpected pool error:", err.message);
});

function query(text, params) {
  return pool.query(text, params);
}

// BEGIN -> fn(client) -> COMMIT, при ошибке ROLLBACK. Внутри fn все запросы идут через client.
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

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
}

module.exports = { pool, query, withTx, migrate };
