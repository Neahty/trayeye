require("./env");
const { createApp } = require("./app");
const db = require("./db");
const vision = require("./services/vision");
const { topUpDemo } = require("./db/seed");
const { today } = require("./utils/dates");

const PORT = Number(process.env.PORT) || 4100;
const TOP_UP_INTERVAL_MS = 60 * 60 * 1000;
// По умолчанию слушаем только localhost: наружу приложение выходит через Caddy.
const HOST = process.env.HOST || "127.0.0.1";

(async () => {
  try {
    await db.migrate();
  } catch (err) {
    console.error("[startup] не удалось применить схему БД:", err.message);
    console.error("Проверь, что PostgreSQL запущен и DATABASE_URL верный.");
    process.exit(1);
  }
  if (!vision.isConfigured()) {
    console.warn("[startup] GEMINI_API_KEY/OPENAI_API_KEY не заданы - распознавание подносов выключено.");
  }
  createApp().listen(PORT, HOST, () => console.log(`TrayEye API на ${HOST}:${PORT}`));
  // Сначала слушаем порт (deploy проверяет health через 3 с), потом догоняем демо в фоне.
  if (process.env.DEMO_TOP_UP !== "0") {
    topUp();
    setInterval(topUp, TOP_UP_INTERVAL_MS).unref();
  }
})();

// Демо не устаревает: раз в час дописываем учебные дни, которых ещё нет.
async function topUp() {
  try {
    const added = await db.withTx((client) => topUpDemo(client, { today: today() }));
    if (added) console.log(`[demo] дописано учебных дней: ${added}`);
  } catch (err) {
    console.error("[demo] не удалось дописать демо-дни:", err.message);
  }
}
