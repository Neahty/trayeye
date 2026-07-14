// Раздел «Квесты» в админке: полный CRUD квестов с наградами.
// criteria хранится как {type, value?} — та же форма, что у достижений; выполнение и прогресс
// считает services/achievements (isUnlocked/metricValue). Награда (reward_link + текст) уходит
// пользователю в ЛС при нажатии «Забрать награду» (services/quests.claim).
const express = require("express");
const db = require("../db");
const adminAuth = require("../middleware/adminAuth");
const { parseId } = require("../utils/http");

const router = express.Router();
router.use(adminAuth);

// Доступные типы условий: label — подпись в админке, value — нужен ли числовой порог.
const CRITERIA = {
  total_scans:          { label: "Сканов еды (всего)",              value: true },
  manual_scans:         { label: "Добавлений вручную/текстом",       value: true },
  text_scans:           { label: "Блюд через AI-описание (текст)",   value: true },
  streak:               { label: "Серия дней подряд",                value: true },
  fat_norm_streak:      { label: "Дней подряд жиры в норме",         value: true },
  days_in_norm:         { label: "Дней в норме калорий",             value: true },
  weight_loss_kg:       { label: "Сброшено кг",                      value: true },
  payments_count:       { label: "Оплат подписки",                   value: true },
  pro_days:             { label: "Дней с подпиской",                 value: true },
  full_week_logged:     { label: "Полная неделя с логом",            value: false },
  profile_filled:       { label: "Профиль заполнен",                 value: false },
  goal_set:             { label: "Цель выбрана",                     value: false },
  has_weight:           { label: "Записан вес",                      value: false },
  goal_weight_reached:  { label: "Достигнут целевой вес",            value: false },
  first_payment:        { label: "Первая оплата",                    value: false },
  dessert_added:        { label: "Добавлен десерт",                  value: false },
  clean_day:            { label: "Чистый день (без фастфуда)",       value: false },
  ideal_macros_day:     { label: "Идеальный день по БЖУ",            value: false },
  day_over_norm:        { label: "День с превышением нормы",         value: false },
  missed_one_day:       { label: "Пропущен один день",              value: false },
  returned_after_break: { label: "Возврат после перерыва",           value: false }
};

function genCode() {
  return "q_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Собирает и валидирует criteria из тела запроса. Возвращает {criteria} или {error}.
function buildCriteria(body) {
  const type = String(body.criteria_type || "").trim();
  const meta = CRITERIA[type];
  if (!meta) return { error: "bad_criteria_type" };
  if (meta.value) {
    const v = Number(body.criteria_value);
    if (!Number.isFinite(v) || v <= 0) return { error: "criteria_value_required" };
    return { criteria: { type, value: Math.round(v) } };
  }
  return { criteria: { type } };
}

// GET /api/admin/quests/meta — справочник типов условий для формы.
router.get("/meta", (req, res) => {
  res.json({
    criteria: Object.entries(CRITERIA).map(([type, m]) => ({ type, label: m.label, needsValue: m.value }))
  });
});

// GET /api/admin/quests — все квесты + число получивших награду.
router.get("/", async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT q.*,
              (SELECT COUNT(*)::int FROM user_quests uq WHERE uq.quest_code = q.code) AS claimed_count
         FROM quests q
        ORDER BY q.sort ASC, q.id ASC`
    );
    res.json({ quests: rows, criteria: Object.entries(CRITERIA).map(([type, m]) => ({ type, label: m.label, needsValue: m.value })) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/quests — создать квест.
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (!title) return res.status(400).json({ error: "title_required" });
    const built = buildCriteria(b);
    if (built.error) return res.status(400).json({ error: built.error });

    let code = String(b.code || "").trim();
    if (!code) code = genCode();
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(code)) return res.status(400).json({ error: "bad_code" });

    const { rows } = await db.query(
      `INSERT INTO quests (code, title, description, emoji, criteria, reward_title, reward_link, reward_message, active, sort)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        code, title, b.description || null, b.emoji || null,
        JSON.stringify(built.criteria),
        b.reward_title || null, b.reward_link || null, b.reward_message || null,
        b.active !== false, Number.isFinite(Number(b.sort)) ? Number(b.sort) : 0
      ]
    );
    db.logAction(req.admin?.id, "admin_action", { action: "quest_create", code });
    res.json({ quest: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "code_exists" });
    next(err);
  }
});

// PATCH /api/admin/quests/:id — обновить квест (частично).
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });
    const b = req.body || {};

    const sets = [];
    const params = [id];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (b.title !== undefined) {
      const title = String(b.title || "").trim();
      if (!title) return res.status(400).json({ error: "title_required" });
      add("title", title);
    }
    if (b.description !== undefined) add("description", b.description || null);
    if (b.emoji !== undefined) add("emoji", b.emoji || null);
    if (b.reward_title !== undefined) add("reward_title", b.reward_title || null);
    if (b.reward_link !== undefined) add("reward_link", b.reward_link || null);
    if (b.reward_message !== undefined) add("reward_message", b.reward_message || null);
    if (b.active !== undefined) add("active", !!b.active);
    if (b.sort !== undefined) add("sort", Number.isFinite(Number(b.sort)) ? Number(b.sort) : 0);
    if (b.criteria_type !== undefined) {
      const built = buildCriteria(b);
      if (built.error) return res.status(400).json({ error: built.error });
      add("criteria", JSON.stringify(built.criteria));
    }

    if (!sets.length) return res.status(400).json({ error: "nothing_to_update" });
    sets.push("updated_at = NOW()");

    const { rows } = await db.query(
      `UPDATE quests SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    db.logAction(req.admin?.id, "admin_action", { action: "quest_update", id });
    res.json({ quest: rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/quests/:id — удалить квест (вместе с фактами получения — ON DELETE CASCADE).
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });
    const { rows } = await db.query("DELETE FROM quests WHERE id = $1 RETURNING code", [id]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    db.logAction(req.admin?.id, "admin_action", { action: "quest_delete", id, code: rows[0].code });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
