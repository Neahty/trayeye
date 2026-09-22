// Раздел «Работники» в админке: сотрудники-пиарщики, их рефералы и выплаты.
// Деньги переводятся вручную вне системы - здесь только учёт: выплата закрывает
// ВСЁ невыплаченное выбранного типа (unit_count × unit_rate), отмена возвращает
// единицы в «невыплаченные». Подробности механики - в services/employeeReferrals.js.
const express = require("express");
const db = require("../db");
const adminAuth = require("../middleware/adminAuth");
const employeeReferrals = require("../services/employeeReferrals");
const { uniqueEmployeeCode } = require("../utils/refcode");
const { parseId } = require("../utils/http");

const router = express.Router();
router.use(adminAuth);

// Сотрудник по id (вместе с данными пользователя) или null.
async function getEmployee(id) {
  const { rows } = await db.query(
    `SELECT e.*, u.telegram_id, u.name, u.username
       FROM employees e JOIN users u ON u.id = e.user_id
      WHERE e.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// GET /api/admin/employees - список с ключевыми цифрами.
router.get("/", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT e.id, e.code, e.active, e.created_at, e.deactivated_at,
              u.telegram_id, u.name, u.username,
              (SELECT COUNT(*)::int FROM employee_link_clicks c WHERE c.employee_id = e.id) AS clicks,
              (SELECT COUNT(*)::int FROM employee_referrals r WHERE r.employee_id = e.id AND r.status = 'confirmed') AS refs_confirmed,
              (SELECT COUNT(*)::int FROM employee_referrals r WHERE r.employee_id = e.id AND r.status = 'pending') AS refs_pending,
              (SELECT COUNT(*)::int FROM employee_referrals r WHERE r.employee_id = e.id AND r.status = 'confirmed' AND r.payout_id IS NULL) AS refs_unpaid,
              (SELECT COUNT(*)::int FROM employee_payments p WHERE p.employee_id = e.id) AS payments_count,
              (SELECT COUNT(*)::int FROM employee_payments p WHERE p.employee_id = e.id AND p.payout_id IS NULL) AS payments_unpaid,
              (SELECT COALESCE(SUM(p.amount), 0)::int FROM employee_payments p WHERE p.employee_id = e.id) AS revenue,
              (SELECT COALESCE(SUM(po.total), 0)::int FROM employee_payouts po WHERE po.employee_id = e.id AND po.status = 'paid') AS paid_total
         FROM employees e JOIN users u ON u.id = e.user_id
        ORDER BY e.active DESC, e.created_at DESC`
    );
    const employees = rows.map((r) => ({ ...r, link: employeeReferrals.buildLink(r.code) }));
    res.json({ employees });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/employees { query } - добавить сотрудника по Telegram ID или @username.
// Человек должен уже существовать в users (нажимал /start) - иначе 404.
router.post("/", async (req, res, next) => {
  try {
    const query = String(req.body?.query || "").trim();
    if (!query) return res.status(400).json({ error: "query_required" });

    const byId = /^\d+$/.test(query);
    const { rows: found } = byId
      ? await db.query("SELECT id, telegram_id FROM users WHERE telegram_id = $1", [query])
      : await db.query("SELECT id, telegram_id FROM users WHERE LOWER(username) = LOWER($1)", [query.replace(/^@/, "")]);
    const user = found[0];
    if (!user) return res.status(404).json({ error: "user_not_found" });

    // Уже активный сотрудник - не дублируем роль и приветствие.
    const { rows: existing } = await db.query(
      "SELECT 1 FROM employees WHERE user_id = $1 AND active = TRUE", [user.id]
    );
    if (existing.length) return res.status(409).json({ error: "already_employee" });

    // Повторное добавление уволенного возвращает роль с ТЕМ ЖЕ кодом:
    // старые напечатанные ссылки продолжают работать, история цела.
    const code = await uniqueEmployeeCode();
    const { rows } = await db.query(
      `INSERT INTO employees (user_id, code, added_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET active = TRUE, deactivated_at = NULL
       RETURNING *, (xmax = 0) AS inserted`,
      [user.id, code, req.admin?.id || null]
    );
    const emp = rows[0];

    employeeReferrals.notifyGranted(emp).catch((e) => console.error("[empRef] notifyGranted:", e.message));
    db.logAction(req.admin?.id, "admin_action", { action: "employee_add", employee_id: emp.id, user_id: user.id });
    res.json({ employee: { ...emp, link: employeeReferrals.buildLink(emp.code) } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/employees/:id - «уволить»: ссылка гаснет, история остаётся.
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });
    const { rows } = await db.query(
      `UPDATE employees SET active = FALSE, deactivated_at = NOW()
        WHERE id = $1 AND active = TRUE RETURNING id`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    db.logAction(req.admin?.id, "admin_action", { action: "employee_remove", employee_id: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/employees/:id - карточка: статистика, рефералы поимённо,
// график за 30 дней, история выплат.
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });
    const emp = await getEmployee(id);
    if (!emp) return res.status(404).json({ error: "not_found" });

    const [stats, referrals, payouts, chart] = await Promise.all([
      employeeReferrals.statsForEmployee(id),
      db.query(
        `SELECT r.id, r.status, r.reject_reason, r.created_at, r.decided_at,
                (r.payout_id IS NOT NULL) AS paid_out,
                u.name, u.username, u.telegram_id,
                (SELECT COUNT(*)::int FROM employee_payments p WHERE p.referral_id = r.id) AS payments_count,
                (SELECT COALESCE(SUM(p.amount), 0)::int FROM employee_payments p WHERE p.referral_id = r.id) AS revenue
           FROM employee_referrals r JOIN users u ON u.id = r.user_id
          WHERE r.employee_id = $1
          ORDER BY r.created_at DESC`,
        [id]
      ).then((r) => r.rows),
      db.query(
        `SELECT * FROM employee_payouts WHERE employee_id = $1 ORDER BY created_at DESC`,
        [id]
      ).then((r) => r.rows),
      // График за 30 дней по московским датам: переходы / рефералы / оплаты.
      db.query(
        `SELECT d.day::text AS day,
                (SELECT COUNT(*)::int FROM employee_link_clicks c
                  WHERE c.employee_id = $1 AND (c.clicked_at AT TIME ZONE $2)::date = d.day) AS clicks,
                (SELECT COUNT(*)::int FROM employee_referrals r
                  WHERE r.employee_id = $1 AND r.status <> 'rejected'
                    AND (r.created_at AT TIME ZONE $2)::date = d.day) AS referrals,
                (SELECT COUNT(*)::int FROM employee_payments p
                  WHERE p.employee_id = $1 AND (p.created_at AT TIME ZONE $2)::date = d.day) AS payments
           FROM generate_series((NOW() AT TIME ZONE $2)::date - 29, (NOW() AT TIME ZONE $2)::date, interval '1 day') AS d(day)
          ORDER BY d.day`,
        [id, employeeReferrals.TZ]
      ).then((r) => r.rows)
    ]);

    res.json({
      employee: { ...emp, link: employeeReferrals.buildLink(emp.code) },
      stats,
      referrals,
      payouts,
      chart
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/employees/:id/payouts { kind, rate } - отметить выплату.
// kind: referrals (за приведённых людей) | subscriptions (за оплаченные подписки).
// Закрывает ВСЁ невыплаченное выбранного типа; сумма = кол-во × ставка.
router.post("/:id/payouts", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });
    const kind = req.body?.kind;
    const rate = Math.round(Number(req.body?.rate));
    if (!["referrals", "subscriptions"].includes(kind)) return res.status(400).json({ error: "bad_kind" });
    if (!Number.isFinite(rate) || rate <= 0) return res.status(400).json({ error: "bad_rate" });
    const emp = await getEmployee(id);
    if (!emp) return res.status(404).json({ error: "not_found" });

    // Всё в одной транзакции: создание выплаты и штамп payout_id на невыплаченных
    // единицах - новый реферал, подтверждённый кроном в этот момент, либо попадёт
    // в счёт целиком, либо останется на следующую выплату.
    const payout = await db.withTx(async (c) => {
      const created = await c.query(
        `INSERT INTO employee_payouts (employee_id, kind, unit_count, unit_rate, total, created_by)
         VALUES ($1, $2, 0, $3, 0, $4) RETURNING id`,
        [id, kind, rate, req.admin?.id || null]
      );
      const payoutId = created.rows[0].id;
      const stamped = kind === "referrals"
        ? await c.query(
            `UPDATE employee_referrals SET payout_id = $2
              WHERE employee_id = $1 AND status = 'confirmed' AND payout_id IS NULL RETURNING id`,
            [id, payoutId]
          )
        : await c.query(
            `UPDATE employee_payments SET payout_id = $2
              WHERE employee_id = $1 AND payout_id IS NULL RETURNING id`,
            [id, payoutId]
          );
      const n = stamped.rows.length;
      if (!n) {
        const err = new Error("nothing_to_pay");
        err.status = 400;
        throw err;
      }
      const upd = await c.query(
        `UPDATE employee_payouts SET unit_count = $2, total = $2 * unit_rate WHERE id = $1 RETURNING *`,
        [payoutId, n]
      );
      return upd.rows[0];
    });

    employeeReferrals.notifyPayout(emp, payout).catch((e) => console.error("[empRef] notifyPayout:", e.message));
    db.logAction(req.admin?.id, "admin_action", {
      action: "employee_payout", employee_id: id, payout_id: payout.id,
      kind, unit_count: payout.unit_count, unit_rate: rate, total: payout.total
    });
    res.json({ payout });
  } catch (err) {
    if (err.message === "nothing_to_pay") return res.status(400).json({ error: "nothing_to_pay" });
    next(err);
  }
});

// POST /api/admin/employees/:id/payouts/:payoutId/cancel - отменить выплату (ошибся).
// Единицы возвращаются в «невыплаченные» и попадут в следующую выплату этого типа.
router.post("/:id/payouts/:payoutId/cancel", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const payoutId = parseId(req.params.payoutId);
    if (!id || !payoutId) return res.status(400).json({ error: "bad_id" });
    const emp = await getEmployee(id);
    if (!emp) return res.status(404).json({ error: "not_found" });

    const payout = await db.withTx(async (c) => {
      const upd = await c.query(
        `UPDATE employee_payouts SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $3
          WHERE id = $1 AND employee_id = $2 AND status = 'paid' RETURNING *`,
        [payoutId, id, req.admin?.id || null]
      );
      if (!upd.rows.length) return null;
      await c.query("UPDATE employee_referrals SET payout_id = NULL WHERE payout_id = $1", [payoutId]);
      await c.query("UPDATE employee_payments SET payout_id = NULL WHERE payout_id = $1", [payoutId]);
      return upd.rows[0];
    });
    if (!payout) return res.status(409).json({ error: "already_cancelled_or_missing" });

    employeeReferrals.notifyPayoutCancelled(emp, payout).catch((e) => console.error("[empRef] notifyPayoutCancelled:", e.message));
    db.logAction(req.admin?.id, "admin_action", { action: "employee_payout_cancel", employee_id: id, payout_id: payoutId });
    res.json({ payout });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
