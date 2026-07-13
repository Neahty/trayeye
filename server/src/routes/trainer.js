const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const checkTrainer = require("../middleware/checkTrainer");
const { notifyClientOfComment, notifyClientConnected, notifyTrainerNewClient } = require("../services/notify");
const settings = require("../utils/settings");
const { userTz, localToday } = require("../utils/tz");
const { ensureRefCode } = require("../utils/refcode");
const { parseId } = require("../utils/http");
const { computeStats } = require("./stats");

const router = express.Router();

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "Bytwise_bot";
async function maxClients() {
  const n = Number(await settings.get("trainer_max_clients"));
  return Number.isFinite(n) && n > 0 ? n : 20;
}

router.use(auth, checkTrainer);

// GET /api/trainer/invite — ссылка-приглашение клиента (открывает мини-апп с привязкой)
router.get("/invite", async (req, res, next) => {
  try {
    // ref_code мог не выдаться (старые аккаунты) — гарантируем валидный код, иначе ссылка ломалась как tr_null.
    const refCode = await ensureRefCode(req.user.id);
    const code = `tr_${refCode}`;
    const link = `https://t.me/${BOT_USERNAME}?startapp=${code}`;
    res.json({
      code,
      link,
      // Без самой ссылки: при «Поделиться» Telegram (t.me/share/url?url=…&text=…) сам
      // подставляет ссылку из url=. Если оставить её ещё и в тексте — ссылка задвоится.
      share_text: "Я буду вести тебя как тренер в Bytwise. Подключись по ссылке →"
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/trainer/clients — список с краткой статистикой за сегодня
router.get("/clients", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.ref_code,
              u.daily_calories,
              COALESCE(s.calories,0) AS today_calories,
              COALESCE(s.protein,0) AS today_protein,
              COALESCE(s.fat,0) AS today_fat,
              COALESCE(s.carbs,0) AS today_carbs
       FROM trainer_clients tc
       JOIN users u ON u.id = tc.client_id
       LEFT JOIN LATERAL (
         SELECT SUM(calories)::int AS calories, SUM(protein) AS protein,
                SUM(fat) AS fat, SUM(carbs) AS carbs
         FROM scans WHERE user_id = u.id
           AND (scanned_at AT TIME ZONE COALESCE(u.timezone,'Europe/Moscow'))::date
             = (NOW() AT TIME ZONE COALESCE(u.timezone,'Europe/Moscow'))::date
       ) s ON TRUE
       WHERE tc.trainer_id = $1
       ORDER BY u.name`,
      [req.user.id]
    );
    res.json({ clients: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/trainer/clients  { client_code }
router.post("/clients", async (req, res, next) => {
  try {
    const code = (req.body?.client_code || "").trim();
    if (!code) return res.status(400).json({ error: "client_code_required" });

    const cl = await db.query("SELECT id FROM users WHERE ref_code = $1", [code]);
    const clientId = cl.rows[0]?.id;
    if (!clientId) return res.status(404).json({ error: "client_not_found" });
    if (clientId === req.user.id) return res.status(400).json({ error: "cannot_add_self" });

    const existing = await db.query("SELECT trainer_id FROM trainer_clients WHERE client_id = $1", [clientId]);
    if (existing.rows.length) return res.status(409).json({ error: "client_already_has_trainer" });

    const count = await db.query("SELECT COUNT(*)::int AS c FROM trainer_clients WHERE trainer_id = $1", [req.user.id]);
    if (count.rows[0].c >= (await maxClients())) return res.status(409).json({ error: "max_clients_reached" });

    try {
      await db.query("INSERT INTO trainer_clients (trainer_id, client_id) VALUES ($1,$2)", [req.user.id, clientId]);
    } catch (e) {
      // UNIQUE(client_id): на гонке клиент уже привязан к тренеру.
      if (e.code === "23505") return res.status(409).json({ error: "client_already_has_trainer" });
      throw e;
    }
    await db.logAction(req.user.id, "trainer_action", { action: "add_client", clientId });
    notifyClientConnected(clientId, req.user).catch(() => {});
    notifyTrainerNewClient(req.user.id, clientId).catch(() => {});
    res.json({ ok: true, client_id: clientId });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/trainer/clients/:client_id
router.delete("/clients/:client_id", async (req, res, next) => {
  try {
    const clientId = parseId(req.params.client_id);
    if (clientId === null) return res.status(400).json({ error: "bad_id" });
    const { rowCount } = await db.query(
      "DELETE FROM trainer_clients WHERE trainer_id = $1 AND client_id = $2",
      [req.user.id, clientId]
    );
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    // После отвязки клиент снова сам управляет своими КБЖУ (вернётся авто-пересчёт нормы).
    await db.query("UPDATE users SET goals_set_by_trainer = FALSE WHERE id = $1", [clientId]);
    await db.logAction(req.user.id, "trainer_action", { action: "remove_client", clientId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// проверка что клиент принадлежит тренеру
async function assertOwnsClient(trainerId, clientId) {
  const { rows } = await db.query(
    "SELECT 1 FROM trainer_clients WHERE trainer_id = $1 AND client_id = $2",
    [trainerId, clientId]
  );
  return rows.length > 0;
}

// Загружает строку клиента (для таймзоны и целей). null если не найден.
async function loadClient(clientId) {
  const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [clientId]);
  return rows[0] || null;
}

// GET /api/trainer/clients/:client_id/history?date=YYYY-MM-DD
router.get("/clients/:client_id/history", async (req, res, next) => {
  try {
    const clientId = parseId(req.params.client_id);
    if (clientId === null) return res.status(400).json({ error: "bad_id" });
    if (!(await assertOwnsClient(req.user.id, clientId))) return res.status(403).json({ error: "not_your_client" });

    const client = await loadClient(clientId);
    const tz = userTz(client || {});
    // День — в часовом поясе клиента (как в остальном приложении), иначе ночные записи уезжают в чужой день.
    // Дефолт «сегодня» тоже в поясе клиента (был UTC через toISOString → off-by-one у полуночи).
    const date = req.query.date || localToday(tz);
    const { rows } = await db.query(
      `SELECT *, to_char(scanned_at AT TIME ZONE $3, 'HH24:MI') AS time_label
        FROM scans
        WHERE user_id = $1 AND (scanned_at AT TIME ZONE $3)::date = $2::date
        ORDER BY scanned_at ASC`,
      [clientId, date, tz]
    );
    const total = rows.reduce((a, s) => {
      a.calories += s.calories || 0; a.protein += Number(s.protein) || 0;
      a.fat += Number(s.fat) || 0; a.carbs += Number(s.carbs) || 0; return a;
    }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
    res.json({
      date,
      scans: rows,
      total,
      goals: {
        daily_calories: client?.daily_calories ?? null,
        daily_protein: client?.daily_protein != null ? Number(client.daily_protein) : null,
        daily_fat: client?.daily_fat != null ? Number(client.daily_fat) : null,
        daily_carbs: client?.daily_carbs != null ? Number(client.daily_carbs) : null
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/trainer/clients/:client_id/stats?period=day|week|month|year — та же статистика, что видит клиент
router.get("/clients/:client_id/stats", async (req, res, next) => {
  try {
    const clientId = parseId(req.params.client_id);
    if (clientId === null) return res.status(400).json({ error: "bad_id" });
    if (!(await assertOwnsClient(req.user.id, clientId))) return res.status(403).json({ error: "not_your_client" });
    const client = await loadClient(clientId);
    if (!client) return res.status(404).json({ error: "client_not_found" });
    res.json(await computeStats(client, req.query.period));
  } catch (err) {
    next(err);
  }
});

// GET /api/trainer/clients/:client_id/weight — история веса клиента
router.get("/clients/:client_id/weight", async (req, res, next) => {
  try {
    const clientId = parseId(req.params.client_id);
    if (clientId === null) return res.status(400).json({ error: "bad_id" });
    if (!(await assertOwnsClient(req.user.id, clientId))) return res.status(403).json({ error: "not_your_client" });
    const { rows } = await db.query(
      "SELECT weight, recorded_at FROM weight_history WHERE user_id = $1 ORDER BY recorded_at ASC",
      [clientId]
    );
    const client = await loadClient(clientId);
    res.json({ weight_history: rows, target_weight: client?.target_weight ?? null });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/trainer/clients/:client_id/goals
router.patch("/clients/:client_id/goals", async (req, res, next) => {
  try {
    const clientId = parseId(req.params.client_id);
    if (clientId === null) return res.status(400).json({ error: "bad_id" });
    if (!(await assertOwnsClient(req.user.id, clientId))) return res.status(403).json({ error: "not_your_client" });

    const { daily_calories, daily_protein, daily_fat, daily_carbs } = req.body || {};
    await db.query(
      `UPDATE users SET daily_calories=$2, daily_protein=$3, daily_fat=$4, daily_carbs=$5,
              goals_set_by_trainer = TRUE WHERE id=$1`,
      [clientId, daily_calories, daily_protein, daily_fat, daily_carbs]
    );
    await db.logAction(req.user.id, "goal_update", { clientId, by: "trainer" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/trainer/scans/:scan_id/comment  { text }
router.post("/scans/:scan_id/comment", async (req, res, next) => {
  try {
    const scanId = parseId(req.params.scan_id);
    if (scanId === null) return res.status(400).json({ error: "bad_id" });
    const text = (req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "text_required" });

    const scan = await db.query("SELECT user_id FROM scans WHERE id = $1", [scanId]);
    const clientId = scan.rows[0]?.user_id;
    if (!clientId) return res.status(404).json({ error: "scan_not_found" });
    if (!(await assertOwnsClient(req.user.id, clientId))) return res.status(403).json({ error: "not_your_client" });

    await db.query("UPDATE scans SET trainer_comment = $2 WHERE id = $1", [scanId, text]);
    await db.logAction(req.user.id, "trainer_action", { action: "comment", scanId });
    notifyClientOfComment(clientId).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
