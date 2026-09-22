const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");

const healthRouter = require("./routes/health");
const authRouter = require("./routes/auth");
const scanRouter = require("./routes/scan");
const historyRouter = require("./routes/history");
const statsRouter = require("./routes/stats");
const profileRouter = require("./routes/profile");
const membershipRouter = require("./routes/membership");
const subscriptionRouter = require("./routes/subscription");
const trainerRouter = require("./routes/trainer");
const myTrainerRouter = require("./routes/myTrainer");
const inviteRouter = require("./routes/invite");
const achievementsRouter = require("./routes/achievements");
const questsRouter = require("./routes/quests");
const settingsPublicRouter = require("./routes/settingsPublic");
const trackRouter = require("./routes/track");
const adminAuthRouter = require("./routes/adminAuth");
const adminEmployeesRouter = require("./routes/adminEmployees");
const adminInvitesRouter = require("./routes/adminInvites");
const adminQuestsRouter = require("./routes/adminQuests");
const adminRouter = require("./routes/admin");
const channelLog = require("./services/channelLog");

function parseCookies(req, _res, next) {
  req.cookies = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const value = part.slice(idx + 1).trim();
    try {
      req.cookies[key] = decodeURIComponent(value);
    } catch {
      req.cookies[key] = value;
    }
  }
  next();
}

function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" }
    })
  );

  // Нативное приложение (Capacitor, iOS) грузит свои файлы с локальной схемы,
  // а не с нашего домена, поэтому его origin надо разрешать всегда — иначе
  // браузерный движок внутри приложения зарубит все запросы к API.
  const NATIVE_ORIGINS = ["capacitor://localhost", "ionic://localhost", "http://localhost"];

  const allowedOrigins = (process.env.CORS_ORIGIN || "*")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .concat(NATIVE_ORIGINS);

  app.use(
    cors({
      origin: allowedOrigins.includes("*") ? true : allowedOrigins,
      credentials: true,
      // Чтобы браузер админки мог прочитать перевыпущенный admin-токен (скользящая сессия).
      exposedHeaders: ["X-Admin-Token"]
    })
  );
  app.use(parseCookies);
  app.use(express.json({ limit: "2mb" }));
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan("tiny"));
  }

  // Раздача загруженных фото.
  // Через /api/uploads — чтобы работало за reverse-proxy (Caddy проксирует /api/*).
  // /uploads оставлен для обратной совместимости / прямого доступа.
  const uploadsDir = path.resolve(__dirname, "../../uploads");
  app.use("/uploads", express.static(uploadsDir));
  app.use("/api/uploads", express.static(uploadsDir));

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/scan", scanRouter);
  app.use("/api/history", historyRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/profile", profileRouter);
  app.use("/api/membership", membershipRouter);
  app.use("/api/subscription", subscriptionRouter);
  app.use("/api/trainer", trainerRouter);
  app.use("/api/my-trainer", myTrainerRouter);
  app.use("/api/invite", inviteRouter);
  app.use("/api/achievements", achievementsRouter);
  app.use("/api/quests", questsRouter);
  app.use("/api/settings", settingsPublicRouter);
  app.use("/api/track", trackRouter);
  app.use("/api/admin/auth", adminAuthRouter);
  // Разделы «Работники», «Приглашения» и «Квесты» — до общего adminRouter, чтобы путь не перехватился им.
  app.use("/api/admin/employees", adminEmployeesRouter);
  app.use("/api/admin/invites", adminInvitesRouter);
  app.use("/api/admin/quests", adminQuestsRouter);
  app.use("/api/admin", adminRouter);

  app.get("/", (req, res) => {
    res.json({ service: "Bytwise API", status: "ok" });
  });

  app.use((req, res) => {
    res.status(404).json({ error: "Not found", path: req.originalUrl });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) {
      console.error("[error]", err.message);
      // Дублируем серьёзные ошибки в Telegram-канал (если включено в настройках).
      channelLog.logError(`${req.method} ${req.originalUrl}`, "Запрос упал — человек увидел ошибку", {
        who: channelLog.whoLabel(req.user), why: err.message
      }).catch(() => {});
      // Не отдаём клиенту внутренний текст 500-ошибки (утечка деталей реализации).
      return res.status(status).json({ error: "internal_error" });
    }
    res.status(status).json({ error: err.message || "error" });
  });

  return app;
}

module.exports = { createApp };
