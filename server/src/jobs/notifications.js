const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const db = require("../db");
const { sendMessage } = require("../services/telegram");
const { backupDatabase } = require("./backup");
const settings = require("../utils/settings");
const notify = require("../services/notify");
const channelLog = require("../services/channelLog");
const channelMembership = require("../services/channelMembership");
const { subscriptionReminders, _internal: subRem } = require("./subscriptionReminders");
// Переиспользуем механику подписочных напоминаний: подстановка плейсхолдеров,
// детерминированный выбор варианта без повторов, общие личные цифры юзера.
const { pickTemplate, loadPersonalStats } = subRem;

const UPLOADS_ROOT = path.resolve(__dirname, "../../../uploads");

// Час из настройки или дефолт (0–23).
function hourOr(v, d) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d;
}

// Конфиг напоминаний о еде поверх дефолтов (битый/частичный объект из админки не валит джоб).
async function loadMealConfig() {
  const def = settings.DEFAULTS.meal_reminders;
  const raw = (await settings.get("meal_reminders")) || {};
  const cfg = { ...def, ...(typeof raw === "object" ? raw : {}) };
  cfg.texts = { ...def.texts, ...(raw && typeof raw.texts === "object" ? raw.texts : {}) };
  cfg.breakfast_hour = hourOr(cfg.breakfast_hour, def.breakfast_hour);
  cfg.lunch_hour = hourOr(cfg.lunch_hour, def.lunch_hour);
  cfg.dinner_hour = hourOr(cfg.dinner_hour, def.dinner_hour);
  return cfg;
}

// Личные цифры именно для напоминаний о еде: калории за сегодня, остаток до цели, серия.
// 0/отрицательные значения возвращаем как null — тогда renderTemplate пропустит такой шаблон
// (например, «осталось 0 ккал» или «серия 0 дн.» не уйдут, выберется вариант попроще).
async function loadMealStats(userId, tz, dailyCaloriesRaw) {
  const today = await db.query(
    `SELECT COALESCE(SUM(calories),0)::int AS cal
       FROM scans
      WHERE user_id = $1 AND (scanned_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date`,
    [userId, tz]
  );
  // Текущая серия: подряд идущие дни с записями, считая от последней записи назад.
  // Серия «активна», только если последняя запись была сегодня или вчера (иначе прервана).
  const streakRow = await db.query(
    `WITH days AS (
       SELECT DISTINCT (scanned_at AT TIME ZONE $2)::date AS d FROM scans WHERE user_id = $1
     ),
     ranked AS (
       SELECT d, ROW_NUMBER() OVER (ORDER BY d DESC) - 1 AS rn, MAX(d) OVER () AS last_d FROM days
     )
     SELECT COUNT(*)::int AS streak FROM ranked
      WHERE last_d >= (NOW() AT TIME ZONE $2)::date - 1 AND (last_d - d) = rn`,
    [userId, tz]
  );
  const eaten = today.rows[0]?.cal || 0;
  const goal = Number(dailyCaloriesRaw) > 0 ? Number(dailyCaloriesRaw) : null;
  const left = goal != null ? goal - eaten : null;
  const streak = streakRow.rows[0]?.streak || 0;
  return {
    daily_calories: goal,
    calories_today: eaten > 0 ? eaten : null,
    calories_left: left != null && left > 0 ? left : null,
    streak: streak > 0 ? streak : null
  };
}

// Собирает данные для подстановки в шаблон приёма пищи.
async function buildMealData(userRow) {
  const personal = await loadPersonalStats(userRow.id, userRow.tz);
  const mealStats = await loadMealStats(userRow.id, userRow.tz, userRow.daily_calories);
  return { name: (userRow.name || "").trim() || null, ...personal, ...mealStats };
}

// Напоминания утром/днём/вечером по локальному времени пользователя.
// Запускается раз в час; для каждого пользователя смотрим его локальный час.
// Тексты, часы и вкл/выкл — в настройке meal_reminders (правится в админке), здесь — механика.
async function mealReminders() {
  const cfg = await loadMealConfig();
  if (cfg.enabled === false) {
    console.log("[cron] mealReminders -> disabled in settings");
    return;
  }
  // Карта «локальный час пользователя -> приёмы пищи». Именно массив: если в админке
  // двум приёмам поставили один и тот же час, отправляем оба напоминания, а не теряем одно
  // (объект с одинаковыми ключами молча затирал бы предыдущий приём).
  const hourMeals = {};
  for (const [meal, h] of [["breakfast", cfg.breakfast_hour], ["lunch", cfg.lunch_hour], ["dinner", cfg.dinner_hour]]) {
    if (!hourMeals[h]) hourMeals[h] = [];
    hourMeals[h].push(meal);
  }

  // Берём пользователей и их локальный час. tz по умолчанию — Москва (если у юзера не выбран),
  // иначе он выпадал из напоминаний, а при неверном поясе час считался не тот.
  const { rows } = await db.query(
    `SELECT u.id, u.telegram_id, u.name, u.daily_calories,
            COALESCE(u.timezone, 'Europe/Moscow') AS tz,
            EXTRACT(HOUR FROM (NOW() AT TIME ZONE COALESCE(u.timezone, 'Europe/Moscow')))::int AS h
     FROM users u
     WHERE u.notifications_enabled = TRUE AND u.is_blocked = FALSE AND u.tg_unreachable = FALSE
       AND u.app_opened = TRUE`
  );
  let sent = 0, failed = 0, skipped = 0, blocked = 0;
  for (const r of rows) {
    const meals = hourMeals[r.h];
    if (!meals) { skipped++; continue; }
    for (const meal of meals) {
      const ex = await db.query(
        `SELECT 1 FROM scans s
         WHERE s.user_id = $1 AND s.meal_type = $2
           AND (s.scanned_at AT TIME ZONE $3)::date = (NOW() AT TIME ZONE $3)::date
         LIMIT 1`,
        [r.id, meal, r.tz]
      );
      if (ex.rows.length) { skipped++; continue; }

      // Вариант текста крутим по дню месяца — один и тот же приём в разные дни даёт разный текст,
      // а в пределах дня выбор воспроизводим. Плейсхолдеры без данных → шаблон пропускается.
      const data = await buildMealData(r);
      const text = pickTemplate(cfg.texts[meal], r.id, new Date().getDate(), data);
      if (!text) {
        skipped++;
        console.warn(`[cron] mealReminders: нет подходящего шаблона ${meal} (user ${r.id}) — пропуск`);
        continue;
      }
      try {
        // sendMessage не бросает исключение, а возвращает { ok:false, error, error_code } при сбое.
        const res = await sendMessage(r.telegram_id, text);
        if (res && res.mock) {
          // mock-режим (нет токена) — не реальная отправка, не считаем сбоем.
          skipped++;
        } else if (res && res.ok === false) {
          failed++;
          console.error(`[cron] mealReminders send failed tg=${r.telegram_id} code=${res.error_code || "?"}: ${res.error || "mock/unknown"}`);
          // 403 — юзер не нажимал Start или заблокировал бота: помечаем tg_unreachable,
          // чтобы не слать впустую. НЕ трогаем is_blocked (это админ-блок + вход).
          // Флаг сбрасывается при следующем успешном входе (routes/auth.js).
          if (res.error_code === 403) {
            blocked++;
            await channelMembership.markUnreachable(r.id);
          }
        } else {
          sent++;
        }
      } catch (e) {
        failed++;
        console.error(`[cron] mealReminders error tg=${r.telegram_id}: ${e.message}`);
      }
    }
  }
  console.log(`[cron] mealReminders -> sent=${sent} failed=${failed} blocked=${blocked} skipped=${skipped}`);
}

// Тестовое напоминание о еде самому себе (кнопка «Проверить на себе» в админке):
// уходит только переданному пользователю (админу). Недостающие личные цифры заполняем
// образцами, чтобы был виден «полный» вид с подстановками.
async function sendTestMealReminder({ meal, user }) {
  const cfg = await loadMealConfig();
  const templates = cfg.texts[meal];
  if (!Array.isArray(templates) || !templates.length) return { ok: false, error: "no_templates" };
  const tz = user.timezone || "Europe/Moscow";
  let personal = {}, mealStats = {};
  try { personal = await loadPersonalStats(user.id, tz); } catch (e) { console.error("[meal] test stats:", e.message); }
  try { mealStats = await loadMealStats(user.id, tz, user.daily_calories); } catch (e) { console.error("[meal] test meal stats:", e.message); }
  const data = {
    name: (user.name || "").trim() || "Дмитрий",
    meals_count: personal.meals_count ?? 47,
    days_tracked: personal.days_tracked ?? 12,
    weight_delta: personal.weight_delta ?? "−2,5 кг",
    daily_calories: mealStats.daily_calories ?? 2000,
    calories_today: mealStats.calories_today ?? 850,
    calories_left: mealStats.calories_left ?? 1150,
    streak: mealStats.streak ?? 5
  };
  const text = pickTemplate(templates, user.id, Math.floor(Math.random() * 100), data);
  if (!text) return { ok: false, error: "no_templates" };
  return sendMessage(user.telegram_id, `🧪 Тест — так это увидит пользователь:\n\n${text}`);
}

// ежедневно 03:00 — удаление фото старше 12 месяцев
async function cleanOldPhotos() {
  const cutoff = Date.now() - 365 * 86400000;
  const usersDir = path.join(UPLOADS_ROOT, "users");
  if (!fs.existsSync(usersDir)) return;
  let removed = 0;
  for (const uid of fs.readdirSync(usersDir)) {
    const dir = path.join(usersDir, uid);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      const fp = path.join(dir, file);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) {
          fs.unlinkSync(fp);
          removed++;
        }
      } catch {}
    }
  }
  console.log(`[cron] cleanOldPhotos -> ${removed}`);
}

// Ежедневная сводка в канал логов: ключевые цифры за последние сутки.
async function dailyDigest() {
  const q = (t) => db.query(t).then((r) => r.rows[0]);
  // Сканы по способу ввода (интервал — наша константа, не пользовательский ввод):
  // сколько посчитали по фото, сколько текстом, сколько вбили руками.
  const scansBySource = (interval) => q(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE source = 'photo')::int  AS photo,
            COUNT(*) FILTER (WHERE source = 'text')::int   AS text,
            COUNT(*) FILTER (WHERE source = 'manual')::int AS manual
       FROM scans WHERE scanned_at >= NOW() - interval '${interval}'`
  );
  // Активный = подписчик канала, открывавший приложение, бот не в ЧС (как в дашборде).
  const [joined, left, pay, dau, scans, scans7, scans30, expired, active, inactive] = await Promise.all([
    q("SELECT COUNT(*)::int AS c FROM users WHERE app_opened = TRUE AND channel_joined_at >= NOW() - interval '1 day'"),
    q("SELECT COUNT(*)::int AS c FROM users WHERE app_opened = TRUE AND channel_left_at >= NOW() - interval '1 day'"),
    q("SELECT COUNT(*)::int AS c, COALESCE(SUM(amount),0)::int AS s FROM payments WHERE status='succeeded' AND created_at >= NOW() - interval '1 day'"),
    q("SELECT COUNT(DISTINCT user_id)::int AS c FROM system_logs WHERE action='login' AND created_at >= NOW() - interval '1 day'"),
    scansBySource("1 day"),
    scansBySource("7 days"),
    scansBySource("30 days"),
    q(`SELECT COUNT(*)::int AS c FROM subscriptions s
        WHERE s.expires_at <= NOW() AND s.expires_at >= NOW() - interval '1 day'
          AND NOT EXISTS (SELECT 1 FROM subscriptions s2 WHERE s2.user_id = s.user_id AND s2.expires_at > NOW())`),
    q("SELECT COUNT(*)::int AS c FROM users WHERE app_opened = TRUE AND channel_member = TRUE AND tg_unreachable = FALSE"),
    q("SELECT COUNT(*)::int AS c FROM users WHERE app_opened = TRUE AND (channel_member = FALSE OR tg_unreachable = TRUE)")
  ]);
  // Строка разбивки: сколько сканов посчитано по фото, сколько текстом, сколько вбито руками.
  const bySource = (s) =>
    `${s.total} (📷 ${s.photo} фото · ✍️ ${s.text} текстом${s.manual ? ` · ✏️ ${s.manual} вручную` : ""})`;
  const text =
    `📊 <b>Сводка за сутки</b>\n\n` +
    `➕ Новые подписчики: ${joined.c}\n` +
    `🚪 Вышли из канала: ${left.c}\n` +
    `🟢 Заходили за сутки: ${dau.c}\n` +
    `💰 Оплаты: ${pay.c} на ${pay.s} ₽\n` +
    `⌛️ Закончились подписки: ${expired.c}\n\n` +
    `<b>Сканы еды за период</b>\n` +
    `За сутки: ${bySource(scans)}\n` +
    `За 7 дней: ${bySource(scans7)}\n` +
    `За 30 дней: ${bySource(scans30)}\n\n` +
    `👥 Активных пользователей: ${active.c}\n` +
    `💤 Неактивных (отписались / в ЧС): ${inactive.c}\n` +
    `Время: ${notify.fmtWhen()}`;
  await channelLog.post("daily_digest", text);
  console.log(`[cron] dailyDigest -> joined=${joined.c} left=${left.c} pay=${pay.c}/${pay.s} scans=${scans.total} active=${active.c}`);
}

// Логируем окончание подписок/пробного. Окно в 2 суток — чтобы поймать истечение,
// даже если запуск пропускался; expiry_logged_at защищает от повторов.
// Берём только тех, у кого нет более поздней активной подписки (реально потеряли доступ).
async function subscriptionExpiryCheck() {
  const { rows } = await db.query(
    `SELECT s.id, s.user_id
       FROM subscriptions s
      WHERE s.expires_at <= NOW() AND s.expires_at >= NOW() - interval '2 days'
        AND s.expiry_logged_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s2
           WHERE s2.user_id = s.user_id AND s2.expires_at > NOW()
        )`
  );
  let logged = 0;
  for (const r of rows) {
    // Фиксируем отметку ДО лога — один раз на подписку, даже при параллельных запусках.
    const ins = await db.query(
      "UPDATE subscriptions SET expiry_logged_at = NOW() WHERE id = $1 AND expiry_logged_at IS NULL RETURNING id",
      [r.id]
    );
    if (!ins.rows.length) continue;
    const who = await notify.userLabel(r.user_id);
    channelLog.post(
      "subscription_expired",
      `⌛️ <b>Подписка закончилась</b>\n\n` +
      `${who} — доступ по подписке истёк.\n` +
      `Время: ${notify.fmtWhen()}`
    ).catch(() => {});
    logged++;
  }
  if (logged) console.log(`[cron] subscriptionExpiryCheck -> logged=${logged}`);
}

// Чистка ссылок «сообщение в канале -> пользователь». Отвечать «.запретить» на логи
// полугодовой давности всё равно никто не будет, а таблица растёт с каждым сообщением.
async function cleanOldLogRefs() {
  const { rowCount } = await db.query("DELETE FROM tg_log_refs WHERE created_at < NOW() - INTERVAL '180 days'");
  if (rowCount) console.log(`[cron] cleanOldLogRefs -> deleted=${rowCount}`);
}

function start() {
  // node-cron: minute hour day month weekday
  cron.schedule("0 * * * *", () => mealReminders().catch((e) => console.error(e.message)));
  // Напоминания о подписке/триале — ежечасно на 5-й минуте (чтобы не сливаться
  // с mealReminders в час отправки); внутри сами проверяют локальный час юзера.
  cron.schedule("5 * * * *", () => subscriptionReminders().catch((e) => console.error(e.message)));
  // Детектор окончания подписок — ежечасно на 10-й минуте (не сливается с другими джобами).
  cron.schedule("10 * * * *", () => subscriptionExpiryCheck().catch((e) => console.error(e.message)));
  cron.schedule("0 3 * * *", () => cleanOldPhotos().catch((e) => console.error(e.message)));
  cron.schedule("30 3 * * *", () => cleanOldLogRefs().catch((e) => console.error("[cron] cleanOldLogRefs:", e.message)));
  // Сотрудники-пиарщики: проверка рефералов через 24 ч + доатрибуция оплат — ежечасно на :20.
  cron.schedule("20 * * * *", () =>
    require("./employeeReferrals").runEmployeeReferralChecks().catch((e) => console.error("[cron] employeeReferrals:", e.message))
  );
  // Пользовательские приглашения «Пригласи друга»: проверка через 24 ч — ежечасно на :25.
  cron.schedule("25 * * * *", () =>
    require("./userInvites").runUserInviteChecks().catch((e) => console.error("[cron] userInvites:", e.message))
  );
  // Ежедневная сводка в канал логов — 21:00 по Москве.
  cron.schedule("0 21 * * *", () => dailyDigest().catch((e) => console.error(e.message)), { timezone: "Europe/Moscow" });
  // Авто-бэкап базы каждый день в 00:00 по Москве — отправляется админам в Telegram.
  cron.schedule("0 0 * * *", () => backupDatabase().catch((e) => console.error(e.message)), { timezone: "Europe/Moscow" });
  console.log("[cron] jobs scheduled");
}

module.exports = { start, mealReminders, sendTestMealReminder, subscriptionReminders, subscriptionExpiryCheck, dailyDigest, cleanOldPhotos, cleanOldLogRefs, backupDatabase };
