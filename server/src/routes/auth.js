const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const jwtUtil = require("../utils/jwt");
const { findActiveLink, demoLink } = require("../services/links");
const { cabinetAuth, loadCabinet } = require("../middleware/cabinetAuth");
const events = require("../services/events");
const { schoolsOf, dishDays } = require("../services/schoolData");
const { kombinatOverview } = require("../services/overview");
const metrics = require("../services/metrics");
const { addDays, today } = require("../utils/dates");
const { parseId, badRequest } = require("../utils/http");

const router = express.Router();

// Перебор ссылок бессмыслен (256 бит), но лимит отсекает шум и ботов.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 30;
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: LOGIN_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_attempts" }
});

// Обмен личной ссылки на сессию.
router.post("/link", loginLimiter, async (req, res, next) => {
  try {
    const link = await findActiveLink(db, req.body?.token);
    if (!link) return res.status(401).json({ error: "invalid_link" });
    await db.query("UPDATE access_links SET last_used_at = NOW() WHERE id = $1", [link.id]);
    const cabinet = await loadCabinet(link.id);
    // Первый вход директора по выданной ссылке - комбинату видно, что приглашение дошло.
    if (cabinet.role === "director" && !link.last_used_at) {
      await events.record(db, {
        kombinatId: cabinet.kombinatId,
        schoolId: cabinet.schoolId,
        audience: "kombinat",
        kind: "director_joined",
        text: `${events.schoolLabel(cabinet)}: директор вошёл в кабинет по новой ссылке (${cabinet.fullName})`,
        link: `/kombinat/schools?focus=school-${cabinet.schoolId}`
      });
    }
    res.json({ token: jwtUtil.sign({ lid: link.id }), cabinet });
  } catch (err) {
    next(err);
  }
});

// Демо-вход со стартовой страницы (жюри, QR из презентации): кабинеты первого комбината
// без личной ссылки и только на просмотр. DEMO_LOGIN=0 выключает.
const DEMO_ROLES = new Set(["kombinat", "director"]);

function demoEnabled() {
  return process.env.DEMO_LOGIN !== "0";
}

async function demoKombinat() {
  const { rows } = await db.query("SELECT id, name FROM kombinats ORDER BY id LIMIT 1");
  return rows[0] || null;
}

// Что показать на стартовой странице: комбинат и школы, в чьи кабинеты можно зайти.
router.get("/demo", async (req, res, next) => {
  try {
    const kombinat = demoEnabled() ? await demoKombinat() : null;
    if (!kombinat) return res.status(404).json({ error: "demo_disabled" });
    const all = await schoolsOf(kombinat.id);
    const date = today();
    const { totals } = await kombinatOverview(all, date);
    // Списания за те же 30 дней, что и экономия: «сегодня» в выходной или утром пустое.
    const month = all.length
      ? metrics.wasteSummary(metrics.onlyScannedDays(await dishDays(all.map((s) => s.id), addDays(date, -totals.economics.days + 1), date)))
      : { plannedRub: 0 };
    const schools = all
      .filter((s) => s.director_id)
      .map((s) => ({ id: s.id, name: s.name, director_name: s.director_name }));
    res.json({
      kombinat: { name: kombinat.name },
      schools,
      totals: {
        schools: totals.schools,
        wastePct: month.plannedRub > 0 ? month.wastePct : null,
        baselinePct: totals.baselinePct,
        economics: totals.economics
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post("/demo", loginLimiter, async (req, res, next) => {
  try {
    const kombinat = demoEnabled() ? await demoKombinat() : null;
    if (!kombinat) return res.status(404).json({ error: "demo_disabled" });
    const role = req.body?.role;
    if (!DEMO_ROLES.has(role)) return badRequest(res, "bad_demo_request");
    let directorId = null;
    if (role === "director") {
      const schoolId = parseId(req.body?.school_id);
      directorId = (await schoolsOf(kombinat.id)).find((s) => s.id === schoolId)?.director_id || null;
      if (!directorId) return badRequest(res, "bad_demo_request");
    }
    const linkId = await demoLink(db, { role, kombinatId: kombinat.id, directorId });
    res.json({ token: jwtUtil.sign({ lid: linkId }), cabinet: await loadCabinet(linkId) });
  } catch (err) {
    next(err);
  }
});

router.get("/me", cabinetAuth(), (req, res) => {
  res.json({ cabinet: req.cabinet });
});

module.exports = router;
