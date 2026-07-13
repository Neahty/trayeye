const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5
});

pool.on("error", (err) => {
  console.error("[support:db] unexpected pool error:", err.message);
});

function query(text, params) {
  return pool.query(text, params);
}

// Создаёт таблицы поддержки (идемпотентно), чтобы бот не зависел
// от npm run migrate основного приложения.
async function ensureSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("[support:db] schema applied");
}

module.exports = { pool, query, ensureSchema };
