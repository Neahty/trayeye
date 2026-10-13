const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");

const db = require("./db");
const authRouter = require("./routes/auth");
const directorRouter = require("./routes/director");
const kombinatRouter = require("./routes/kombinat");
const { WEB_DIST } = require("./config");

function corsOptions() {
  const origins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // Без CORS_ORIGIN фронт и API живут на одном домене - кросс-доменные запросы не нужны.
  return { origin: origins.length ? origins : false };
}

// Собранный web/ раздаём тем же сервисом: один процесс на всё демо.
// Маршруты фронтенда (пути без расширения) получают index.html, а отсутствующий файл - честный 404.
function serveWeb(app) {
  if (!fs.existsSync(path.join(WEB_DIST, "index.html"))) return;
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api\/)[^.]*$/, (req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
}

function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: "100kb" }));
  if (process.env.NODE_ENV !== "test") app.use(morgan("tiny"));

  app.get("/api/health", async (req, res) => {
    try {
      await db.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "db_unavailable" });
    }
  });
  app.use("/api/auth", authRouter);
  app.use("/api/director", directorRouter);
  app.use("/api/kombinat", kombinatRouter);
  app.use("/api", (req, res) => res.status(404).json({ error: "not_found" }));

  serveWeb(app);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}:`, err.message);
    // Текст внутренней ошибки наружу не отдаём.
    res.status(status).json({ error: status >= 500 ? errorCode(err) : err.expose ? err.message : "bad_request" });
  });

  return app;
}

// Для известных сбоев (ИИ не настроен / не ответил) отдаём их код, остальное - internal_error.
function errorCode(err) {
  return ["ai_not_configured", "ai_failed"].includes(err.message) ? err.message : "internal_error";
}

module.exports = { createApp };
