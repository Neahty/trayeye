// Квесты с наградами (заменяют экран достижений). Прогресс/выполнение считаются той же
// машинкой, что и достижения (achievements.gatherMetrics/isUnlocked). При «Забрать награду»
// пользователю уходит красивое сообщение в ЛС со ссылкой-кнопкой.
const db = require("../db");
const { userTz } = require("../utils/tz");
const { gatherMetrics, isUnlocked, metricValue } = require("./achievements");
const telegram = require("./telegram");

// Экранирование для parse_mode=HTML (значения из БД могут содержать <, >, &).
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Список квестов для пользователя со статусами (в процессе / доступно / получено).
async function getForUser(userId, user) {
  const { rows: catalog } = await db.query(
    "SELECT * FROM quests WHERE active = TRUE ORDER BY sort ASC, id ASC"
  );
  const { rows: claims } = await db.query(
    "SELECT quest_code, claimed_at FROM user_quests WHERE user_id = $1",
    [userId]
  );
  const claimed = new Map(claims.map((r) => [r.quest_code, r.claimed_at]));
  const metrics = await gatherMetrics(userId, user, userTz(user));

  const quests = catalog.map((q) => {
    const { current, goal } = metricValue(q.criteria, metrics);
    const complete = isUnlocked(q.criteria, metrics, 0);
    const isClaimed = claimed.has(q.code);
    const shown = Math.min(current, goal);
    const pct = goal > 0 ? Math.min(100, Math.round((shown / goal) * 100)) : (complete ? 100 : 0);
    return {
      code: q.code,
      title: q.title,
      description: q.description,
      emoji: q.emoji,
      reward_title: q.reward_title,
      criteria_type: q.criteria?.type,
      current: shown,
      goal,
      pct,
      complete,
      claimed: isClaimed,
      claimed_at: claimed.get(q.code) || null
    };
  });

  return { quests, total: quests.length, claimed: quests.filter((q) => q.claimed).length };
}

// Текст сообщения в ЛС: свой шаблон квеста (с переменными) или дефолтный.
function buildMessage(user, quest) {
  const name = esc(user.name || "");
  const questTitle = esc(quest.title);
  const rewardTitle = esc(quest.reward_title || quest.title);
  const link = esc(quest.reward_link || "");
  if (quest.reward_message && String(quest.reward_message).trim()) {
    return String(quest.reward_message)
      .replace(/\{name\}/g, name)
      .replace(/\{quest_title\}/g, questTitle)
      .replace(/\{quest\}/g, questTitle)
      .replace(/\{reward_title\}/g, rewardTitle)
      .replace(/\{reward\}/g, rewardTitle)
      .replace(/\{link\}/g, link);
  }
  return (
    `🎉 <b>Поздравляем${name ? ", " + name : ""}!</b>\n\n` +
    `Вы выполнили квест «${questTitle}» и заработали награду:\n` +
    `🎁 <b>${rewardTitle}</b>\n\n` +
    `Забрать её можно по кнопке ниже 👇`
  );
}

// Получить награду: проверяем выполнение и повтор, шлём ЛС, фиксируем факт (один раз на юзера).
// Claim фиксируется ТОЛЬКО при успешной доставке в ЛС — если бот не запущен (403),
// возвращаем dm_unavailable, чтобы клиент показал тост с ошибкой и юзер мог повторить.
async function claim(userId, user, code) {
  const { rows } = await db.query("SELECT * FROM quests WHERE code = $1 AND active = TRUE", [code]);
  const quest = rows[0];
  if (!quest) return { ok: false, status: 404, error: "quest_not_found" };

  const existing = await db.query(
    "SELECT 1 FROM user_quests WHERE user_id = $1 AND quest_code = $2",
    [userId, code]
  );
  if (existing.rows.length) return { ok: false, status: 409, error: "already_claimed" };

  const metrics = await gatherMetrics(userId, user, userTz(user));
  if (!isUnlocked(quest.criteria, metrics, 0)) {
    return { ok: false, status: 400, error: "not_completed" };
  }

  const tgRow = (await db.query("SELECT telegram_id FROM users WHERE id = $1", [userId])).rows[0];
  if (!tgRow || !tgRow.telegram_id) return { ok: false, status: 400, error: "no_telegram" };

  const text = buildMessage(user, quest);
  const extra = {};
  if (quest.reward_link) {
    extra.reply_markup = { inline_keyboard: [[{ text: "🎁 Забрать награду", url: quest.reward_link }]] };
  }
  const sent = await telegram.sendMessage(tgRow.telegram_id, text, extra);
  if (!sent || sent.ok === false) {
    // 403 = бот не запущен/заблокирован. Не фиксируем claim.
    return { ok: false, status: 409, error: "dm_unavailable" };
  }

  await db.query(
    "INSERT INTO user_quests (user_id, quest_code) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [userId, code]
  );
  await db.logAction(userId, "quest_claim", { code, reward: quest.reward_title || null });
  return { ok: true };
}

module.exports = { getForUser, claim, buildMessage };
