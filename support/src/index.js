const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const config = require("./config");
config.assertConfig();

const db = require("./db");
const { createBot } = require("./bot");

process.on("unhandledRejection", (err) => console.error("[support] unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("[support] uncaughtException:", err));

(async () => {
  try {
    await db.ensureSchema();
  } catch (err) {
    // У AggregateError (ECONNREFUSED) message пустой — показываем код ошибки.
    console.error("[support] не удалось подключиться к базе:", err.message || err.code || err);
    console.error("[support] проверьте, что PostgreSQL запущен и DATABASE_URL в support/.env верный.");
    process.exit(1);
  }

  const bot = createBot();
  bot.launch()
    .then(() => console.log("[support] bot launched (long polling)"))
    .catch((err) => {
      console.error("[support] launch error:", err.message);
      process.exit(1);
    });
  console.log(`[support] админы: ${config.ADMIN_IDS.join(", ")}`);

  const shutdown = async (signal) => {
    console.log(`[support] ${signal} — останавливаюсь`);
    try { bot.stop(signal); } catch { /* уже остановлен */ }
    try { await db.pool.end(); } catch { /* ок */ }
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
})();
