const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const settings = require("../utils/settings");
const { isTrainer, getActiveTrainer } = require("../utils/subscription");
const { notifyClientConnected, notifyTrainerNewClient } = require("../services/notify");

const router = express.Router();
router.use(auth);

async function maxClients() {
  const n = Number(await settings.get("trainer_max_clients"));
  return Number.isFinite(n) && n > 0 ? n : 20;
}

function pubTrainer(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, username: u.username };
}

// GET /api/my-trainer - текущий АКТИВНЫЙ тренер клиента (или null)
router.get("/", async (req, res, next) => {
  try {
    const trainer = await getActiveTrainer(req.user.id);
    res.json({ trainer: pubTrainer(trainer), access_from_trainer: Boolean(trainer) });
  } catch (err) {
    next(err);
  }
});

// POST /api/my-trainer/accept { code, replace? } - подключиться к тренеру по ссылке (code = tr_<refCode>)
router.post("/accept", async (req, res, next) => {
  try {
    const raw = String(req.body?.code || "").trim();
    const refCode = raw.startsWith("tr_") ? raw.slice(3) : raw;
    if (!refCode) return res.status(400).json({ error: "code_required" });

    const tr = await db.query("SELECT id, name, username FROM users WHERE ref_code = $1", [refCode]);
    const trainer = tr.rows[0];
    if (!trainer) return res.status(404).json({ error: "trainer_not_found" });
    if (trainer.id === req.user.id) return res.status(400).json({ error: "cannot_add_self" });
    if (!(await isTrainer(trainer.id))) return res.status(400).json({ error: "trainer_inactive" });

    // Уже привязан к кому-то?
    const cur = await db.query(
      `SELECT u.id, u.name, u.username FROM trainer_clients tc
        JOIN users u ON u.id = tc.trainer_id WHERE tc.client_id = $1`,
      [req.user.id]
    );
    const current = cur.rows[0];
    if (current) {
      if (current.id === trainer.id) return res.json({ ok: true, trainer: pubTrainer(trainer) });
      if (!req.body?.replace) {
        return res.status(409).json({
          conflict: true,
          current_trainer: pubTrainer(current),
          new_trainer: pubTrainer(trainer)
        });
      }
      // Смена тренера: отвязываем старого и сбрасываем цели (клиент/новый тренер зададут заново).
      await db.query("DELETE FROM trainer_clients WHERE client_id = $1", [req.user.id]);
      await db.query("UPDATE users SET goals_set_by_trainer = FALSE WHERE id = $1", [req.user.id]);
    }

    // Лимит клиентов у тренера
    const cnt = await db.query("SELECT COUNT(*)::int AS c FROM trainer_clients WHERE trainer_id = $1", [trainer.id]);
    if (cnt.rows[0].c >= (await maxClients())) return res.status(409).json({ error: "max_clients_reached" });

    try {
      await db.query("INSERT INTO trainer_clients (trainer_id, client_id) VALUES ($1, $2)", [trainer.id, req.user.id]);
    } catch (e) {
      // UNIQUE(client_id): параллельная привязка успела раньше.
      if (e.code === "23505") {
        const again = await db.query(
          `SELECT u.id, u.name, u.username FROM trainer_clients tc JOIN users u ON u.id = tc.trainer_id WHERE tc.client_id = $1`,
          [req.user.id]
        );
        return res.json({ ok: true, trainer: pubTrainer(again.rows[0] || trainer) });
      }
      throw e;
    }
    await db.logAction(req.user.id, "trainer_action", { action: "client_joined", trainerId: trainer.id });
    notifyClientConnected(req.user.id, trainer).catch(() => {});
    notifyTrainerNewClient(trainer.id, req.user.id).catch(() => {});
    res.json({ ok: true, trainer: pubTrainer(trainer) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/my-trainer - клиент сам отвязывается от тренера
router.delete("/", async (req, res, next) => {
  try {
    const { rowCount } = await db.query("DELETE FROM trainer_clients WHERE client_id = $1", [req.user.id]);
    // Клиент снова сам управляет своими КБЖУ.
    await db.query("UPDATE users SET goals_set_by_trainer = FALSE WHERE id = $1", [req.user.id]);
    if (rowCount) await db.logAction(req.user.id, "trainer_action", { action: "client_left" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
