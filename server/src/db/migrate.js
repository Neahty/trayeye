require("../env");
const db = require(".");

db.migrate()
  .then(() => {
    console.log("[migrate] schema applied");
    return db.pool.end();
  })
  .catch((err) => {
    console.error("[migrate] failed:", err.message);
    process.exit(1);
  });
