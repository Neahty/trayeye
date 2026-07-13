// Применяет schema.sql и синхронизирует админов. Запуск: npm run migrate
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });
const db = require("./index");

(async () => {
  try {
    await db.init();
    console.log("[migrate] done");
    process.exit(0);
  } catch (err) {
    console.error("[migrate] failed:", err.message);
    process.exit(1);
  }
})();
