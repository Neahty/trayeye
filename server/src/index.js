require("./env");
const { createApp } = require("./app");
const db = require("./db");
const vision = require("./services/vision");

const PORT = Number(process.env.PORT) || 4100;

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
  createApp().listen(PORT, () => console.log(`TrayEye API на порту ${PORT}`));
})();
