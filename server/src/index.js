require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { createApp } = require("./app");
const db = require("./db");
const { launchBot } = require("./services/bot");
const notifications = require("./jobs/notifications");

const PORT = process.env.PORT || 4000;
const IS_PROD = process.env.NODE_ENV === "production";

// Проверка окружения до старта. Обе ошибки ниже раньше проявлялись молча - сервис
// поднимался и работал, а узнать о проблеме можно было только по счёту или по жалобе.
function checkConfig() {
  // Пустые ключи ЮKassa переводят оплату в mock-режим (services/yukassa.js:isMock),
  // где подписка выдаётся БЕЗ оплаты, а /api/subscription/mock-confirm активирует её
  // вообще без авторизации. В проде это тихий и полный обход платежей, поэтому падаем.
  if (IS_PROD && process.env.PAYMENTS_MODE !== "mock") {
    if (!process.env.YUKASSA_SHOP_ID || !process.env.YUKASSA_SECRET_KEY) {
      console.error("[startup] YUKASSA_SHOP_ID/YUKASSA_SECRET_KEY не заданы, а NODE_ENV=production.");
      console.error("Без них оплата уходит в mock-режим и подписки выдаются бесплатно. Отказываюсь стартовать.");
      process.exit(1);
    }
  }

  // Без ключа Gemini цепочка провайдеров вырождается в один платный OpenAI: ошибки нет,
  // всё работает, но каждый скан начинает стоить деньги. Это должно быть видно сразу.
  if (!process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEYS) {
    console.warn("[startup] ВНИМАНИЕ: GEMINI_API_KEY не задан - все сканы уйдут на платный OpenAI.");
    require("./services/channelLog")
      .logError("startup", "GEMINI_API_KEY не задан: все сканы идут на платный OpenAI")
      .catch(() => {});
  }
}

(async () => {
  checkConfig();

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

  // Анонс обновления в канал логов: деплой перезапускает сервис, так что старт = выкат.
  // Шлём, только если в CHANGELOG.md появился новый блок (проверка по хэшу внутри).
  require("./services/deployNotice").announceDeploy().catch((e) =>
    console.error("[startup] announceDeploy:", e.message)
  );

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
    // Дожидаемся завершения запросов в полёте, а не рвём их сразу: скан ждёт ответа AI
    // до минуты, и обрыв на деплое означал бы потерю уже ОПЛАЧЕННОГО вызова. Потолок
    // 30 с - дальше закрываемся принудительно, чтобы деплой не завис.
    await new Promise((resolve) => {
      const force = setTimeout(() => {
        console.warn("[shutdown] не дождался завершения запросов за 30 с, закрываюсь принудительно");
        resolve();
      }, 30_000);
      server.close(() => {
        clearTimeout(force);
        console.log("[shutdown] HTTP-сервер остановлен");
        resolve();
      });
    });
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
// После необработанного исключения состояние процесса недостоверно: могли остаться
// полузакрытые соединения и незавершённые транзакции. Раньше процесс продолжал жить
// в этом состоянии и не перезапускался никогда. Выходим с ненулевым кодом и доверяем
// рестарт systemd (Restart=always) - он поднимет заведомо чистый процесс.
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err.stack || err.message);
  process.exit(1);
});
