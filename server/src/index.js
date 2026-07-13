require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { createApp } = require("./app");
const db = require("./db");
const { launchBot } = require("./services/bot");
const notifications = require("./jobs/notifications");

const PORT = process.env.PORT || 4000;

(async () => {
  try {
    await db.init();
  } catch (err) {
    console.error("[startup] DB init failed:", err.message);
    console.error("Убедись, что PostgreSQL запущен (служба postgresql) и DATABASE_URL верный.");
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`Bytwise API на порту ${PORT}`);
  });

  // Бот и крон-задачи (не блокируют API)
  launchBot();
  notifications.start();

  // Прогрев кэшей внешних API (курс ЦБ + расходы OpenAI), чтобы первое открытие
  // раздела «Расходы на ИИ» в админке не висело на сетевом запросе.
  require("./services/fx").getUsdRub().catch(() => {});
  require("./services/openaiCosts").getCosts(30).catch(() => {});

  // Аккуратная остановка: закрываем приём запросов и пул БД, чтобы не оборвать
  // обработку на полуслове при перезапуске/деплое.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] получен ${signal}, останавливаюсь…`);
    server.close(() => console.log("[shutdown] HTTP-сервер остановлен"));
    try { await db.pool.end(); } catch (e) { console.error("[shutdown] pool.end:", e.message); }
    process.exit(0);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();

// Глобальная страховка: логируем непойманные ошибки, а не падаем молча без следа в логе.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason instanceof Error ? reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err.message);
});
