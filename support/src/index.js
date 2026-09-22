const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const config = require("./config");
config.assertConfig();

const db = require("./db");
const { createBot } = require("./bot");

process.on("unhandledRejection", (err) => console.error("[support] unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("[support] uncaughtException:", err));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// После перезагрузки/деплоя сервис поднимается раньше, чем PostgreSQL начинает
// принимать соединения, и падал на первом же ECONNREFUSED. Даём базе до минуты.
async function connectWithRetry(attempts = 12, delayMs = 5000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await db.ensureSchema();
      return;
    } catch (err) {
      // У AggregateError (ECONNREFUSED) message пустой - показываем код ошибки.
      const reason = err.message || err.code || err;
      if (i === attempts) throw new Error(reason);
      console.warn(`[support] база не отвечает (${reason}), попытка ${i}/${attempts}, повтор через ${delayMs / 1000}с`);
      await sleep(delayMs);
    }
  }
}

(async () => {
  try {
    await connectWithRetry();
  } catch (err) {
    console.error("[support] не удалось подключиться к базе:", err.message);
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
    console.log(`[support] ${signal} - останавливаюсь`);
    try { bot.stop(signal); } catch { /* уже остановлен */ }
    try { await db.pool.end(); } catch { /* ок */ }
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
})();
