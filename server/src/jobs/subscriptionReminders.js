// Напоминания о подписке и пробном периоде.
// Запускается ежечасно; шлёт тем, у кого сейчас локально «час отправки» из настроек.
// Всё расписание и тексты — в настройке `reminders` (правится из админки),
// в коде только механика. Дедупликация — таблица subscription_reminders:
// одна строка = одна отправленная стадия, повторный запуск ничего не дублирует.
//
// ВАЖНО: notifications_enabled здесь сознательно игнорируется (бизнес-критичные
// сообщения), но is_blocked/tg_unreachable уважаем, а клиентов активного тренера
// не трогаем — у них и так есть доступ.
const db = require("../db");
const settings = require("../utils/settings");
const { sendMessage } = require("../services/telegram");
const channelMembership = require("../services/channelMembership");
const notifyLog = require("../services/notifyLog");

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "Bytwise_bot";

// Конфиг из настроек поверх дефолтов: если админ сохранил частичный/битый объект,
// недостающие поля берём из DEFAULTS, чтобы джоб не падал.
async function loadConfig() {
  const def = settings.DEFAULTS.reminders;
  const raw = (await settings.get("reminders")) || {};
  const cfg = { ...def, ...(typeof raw === "object" ? raw : {}) };
  cfg.texts = { ...def.texts, ...(raw && typeof raw.texts === "object" ? raw.texts : {}) };
  cfg.paid_pre_days = toDayList(cfg.paid_pre_days, def.paid_pre_days);
  cfg.post_days = toDayList(cfg.post_days, def.post_days);
  cfg.send_hour = Number.isFinite(Number(cfg.send_hour)) ? Number(cfg.send_hour) : def.send_hour;
  return cfg;
}

// Список дней из настройки: числа ≥ 0, без дублей, по возрастанию.
function toDayList(value, fallback) {
  const list = (Array.isArray(value) ? value : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
  return list.length ? [...new Set(list)].sort((a, b) => a - b) : fallback;
}

// Подстановка плейсхолдеров. Если в шаблоне есть {ключ}, для которого нет данных
// (null/undefined) — возвращаем null: вызывающий возьмёт следующий шаблон.
function renderTemplate(tpl, data) {
  let missing = false;
  const text = String(tpl).replace(/\{(\w+)\}/g, (_, key) => {
    const v = data[key];
    if (v === null || v === undefined || v === "") { missing = true; return ""; }
    return String(v);
  });
  return missing ? null : text;
}

// Детерминированный выбор шаблона: (user_id + номер стадии) по кругу до первого
// рендерящегося. Без случайности — пользователь не получает один текст дважды
// за серию, а поведение воспроизводимо.
function pickTemplate(templates, userId, stageIndex, data) {
  const list = (Array.isArray(templates) ? templates : []).filter((t) => typeof t === "string" && t.trim());
  if (!list.length) return null;
  const start = (userId + stageIndex) % list.length;
  for (let i = 0; i < list.length; i++) {
    const text = renderTemplate(list[(start + i) % list.length], data);
    if (text) return text;
  }
  return null;
}

// Изменение веса: «−2,5 кг» / «+1,2 кг» (первая vs последняя запись), либо null.
function formatWeightDelta(firstW, lastW) {
  // Number(null) === 0 — поэтому сначала явная проверка на отсутствие записей.
  if (firstW === null || firstW === undefined || lastW === null || lastW === undefined) return null;
  const a = Number(firstW), b = Number(lastW);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const delta = b - a;
  if (Math.abs(delta) < 0.3) return null;
  const sign = delta < 0 ? "−" : "+";
  return sign + Math.abs(delta).toFixed(1).replace(".", ",") + " кг";
}

// Личные цифры для плейсхолдеров — два маленьких запроса, только для тех,
// кто прошёл дедуп (единицы пользователей в день).
async function loadPersonalStats(userId, tz) {
  const scans = await db.query(
    `SELECT COUNT(DISTINCT COALESCE(batch_id, id::text))::int AS meals,
            COUNT(DISTINCT (scanned_at AT TIME ZONE $2)::date)::int AS days
       FROM scans WHERE user_id = $1`,
    [userId, tz]
  );
  const weight = await db.query(
    `SELECT (SELECT weight FROM weight_history WHERE user_id = $1 ORDER BY recorded_at ASC  LIMIT 1) AS first_w,
            (SELECT weight FROM weight_history WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 1) AS last_w`,
    [userId]
  );
  const meals = scans.rows[0]?.meals || 0;
  const days = scans.rows[0]?.days || 0;
  return {
    meals_count: meals > 0 ? meals : null,
    days_tracked: days > 0 ? days : null,
    weight_delta: formatWeightDelta(weight.rows[0]?.first_w, weight.rows[0]?.last_w)
  };
}

// Определяем, какая стадия (если есть) положена пользователю сегодня по расписанию.
// Возвращает { kind, stage, stageIndex, anchor, textsKey, extra } или null.
// textsKey — ключ в reminders.texts (для kind='trial' это trial_start/trial_end!).
function classify(row, cfg, trialDays) {
  // Клиент активного тренера — доступ и так есть, не дёргаем.
  if (row.has_active_trainer) return null;

  const postDays = cfg.post_days;
  const maxPost = Math.max(...postDays);

  if (row.sub_expires_at) {
    // Есть подписка (берём строку с максимальным expires_at).
    const daysTo = row.days_to_expiry; // expiry_date − today (в tz юзера)
    if (daysTo > 0) {
      // Активная и не истекает сегодня: напоминаем заранее (только если статус active —
      // отозванную админом не «продлеваем», это ручное решение).
      if (row.sub_status !== "active") return null;
      if (!cfg.paid_pre_days.includes(daysTo)) return null;
      return {
        kind: "paid_pre", stage: "d" + daysTo,
        stageIndex: cfg.paid_pre_days.indexOf(daysTo),
        anchor: row.sub_expires_at, textsKey: "paid_pre",
        extra: { days_left: daysTo, expires_date: fmtDate(row.sub_expires_at, row.tz) }
      };
    }
    // Истекла (или истекает сегодня): серия «после окончания».
    const diff = -daysTo; // today − expiry_date
    if (diff > maxPost || !postDays.includes(diff)) return null;
    return {
      kind: "paid_post", stage: "p" + diff,
      stageIndex: postDays.indexOf(diff),
      anchor: row.sub_expires_at, textsKey: "paid_post", extra: {}
    };
  }

  // Подписок не было никогда — пробный период.
  // Триал считаем по календарным дням в tz юзера: день старта = день 1,
  // последний день = день № trial_days. Конец доступа — как в checkLimit.js.
  const sinceStart = row.days_since_trial_start; // today − trial_start_date
  if (sinceStart === null || sinceStart === undefined) return null;
  const lastDayOffset = Math.max(trialDays - 1, 0);
  const anchor = row.trial_started_at;

  if (sinceStart <= 1 && sinceStart < lastDayOffset) {
    // Первый день (окно-«догонялка»: зарегистрировался после часа отправки — получит завтра).
    return { kind: "trial", stage: "start", stageIndex: 0, anchor, textsKey: "trial_start", extra: {} };
  }
  if (sinceStart === lastDayOffset) {
    return { kind: "trial", stage: "end", stageIndex: 1, anchor, textsKey: "trial_end", extra: {} };
  }
  if (sinceStart > lastDayOffset) {
    // Доступ кончился. День 0 серии = первый день БЕЗ доступа.
    const diff = sinceStart - lastDayOffset - 1;
    if (diff < 0 || diff > maxPost || !postDays.includes(diff)) return null;
    return {
      kind: "trial_post", stage: "p" + diff,
      stageIndex: postDays.indexOf(diff),
      anchor, textsKey: "trial_post", extra: {}
    };
  }
  return null;
}

// Режим «Разослать сейчас» из админки: не сверяемся с расписанием, а отправляем
// КАЖДОМУ его текущую ситуацию: пробный идёт / последний день / пробный кончился /
// подписка скоро истечёт / подписка истекла (сколько бы дней ни прошло).
// Дедуп — по дате: kind='manual_<тип>', stage=YYYY-MM-DD, т.е. повторное нажатие
// в тот же день никого не задвоит, а завтра можно разослать снова.
function classifyBlast(row, cfg, trialDays, today) {
  if (row.has_active_trainer) return null;

  if (row.sub_expires_at) {
    const daysTo = row.days_to_expiry;
    if (daysTo > 0) {
      if (row.sub_status !== "active") return null;
      // Дальше горизонта напоминаний (деф. 7 дней) — рано дёргать человека.
      const maxPre = Math.max(...cfg.paid_pre_days);
      if (daysTo > maxPre) return null;
      return {
        kind: "manual_paid_pre", stage: today, anchor: row.sub_expires_at, textsKey: "paid_pre",
        extra: { days_left: daysTo, expires_date: fmtDate(row.sub_expires_at, row.tz) }
      };
    }
    return { kind: "manual_paid_post", stage: today, anchor: row.sub_expires_at, textsKey: "paid_post", extra: {} };
  }

  const sinceStart = row.days_since_trial_start;
  if (sinceStart === null || sinceStart === undefined) return null;
  const lastDayOffset = Math.max(trialDays - 1, 0);
  const anchor = row.trial_started_at;

  if (sinceStart < lastDayOffset) {
    return { kind: "manual_trial_start", stage: today, anchor, textsKey: "trial_start", extra: {} };
  }
  if (sinceStart === lastDayOffset) {
    return { kind: "manual_trial_end", stage: today, anchor, textsKey: "trial_end", extra: {} };
  }
  return { kind: "manual_trial_post", stage: today, anchor, textsKey: "trial_post", extra: {} };
}

function fmtDate(d, tz) {
  try {
    return new Date(d).toLocaleDateString("ru-RU", { timeZone: tz || "Europe/Moscow" });
  } catch {
    return new Date(d).toLocaleDateString("ru-RU");
  }
}

// force: true — игнорировать локальный час пользователей (обработать всех прямо сейчас).
// blast: true — режим «Разослать сейчас» из админки: каждому уходит сообщение по его
//   ТЕКУЩЕЙ ситуации (см. classifyBlast), а не по точному совпадению с расписанием.
// Дедуп работает в обоих режимах; плюс общий предохранитель — не больше одного
// напоминания о подписке в сутки на человека (blast и крон не задвоят друг друга).
// Возвращает статистику для показа в админке.
async function subscriptionReminders({ force = false, blast = false } = {}) {
  const cfg = await loadConfig();
  if (cfg.enabled === false) {
    console.log("[cron] subscriptionReminders -> disabled in settings");
    return { disabled: true, sent: 0, failed: 0, blocked: 0, skipped: 0, total: 0 };
  }
  const trialDays = Number(await settings.get("trial_days")) || 3;
  const forceRun = force || blast || Boolean(process.env.REMINDER_FORCE);
  const today = new Date().toISOString().slice(0, 10); // дата для дедупа blast-режима

  // Один запрос: пользователи, у кого сейчас локально «час отправки», с последней
  // подпиской, признаком «клиент активного тренера» и разницами дат в их tz.
  const { rows } = await db.query(
    `SELECT u.id, u.telegram_id, u.name,
            COALESCE(u.timezone, 'Europe/Moscow') AS tz,
            COALESCE(u.trial_started_at, u.created_at) AS trial_started_at,
            sub.expires_at AS sub_expires_at, sub.status AS sub_status,
            (sub.expires_at AT TIME ZONE COALESCE(u.timezone,'Europe/Moscow'))::date
              - (NOW() AT TIME ZONE COALESCE(u.timezone,'Europe/Moscow'))::date AS days_to_expiry,
            (NOW() AT TIME ZONE COALESCE(u.timezone,'Europe/Moscow'))::date
              - (COALESCE(u.trial_started_at, u.created_at) AT TIME ZONE COALESCE(u.timezone,'Europe/Moscow'))::date AS days_since_trial_start,
            EXISTS (
              SELECT 1 FROM trainer_clients tc
              JOIN subscriptions ts ON ts.user_id = tc.trainer_id
               AND ts.type = 'trainer' AND ts.status = 'active' AND ts.expires_at > NOW()
              WHERE tc.client_id = u.id
            ) AS has_active_trainer,
            EXISTS (
              SELECT 1 FROM subscription_reminders sr
              WHERE sr.user_id = u.id AND sr.sent_at > NOW() - INTERVAL '20 hours'
            ) AS reminded_recently
       FROM users u
       LEFT JOIN LATERAL (
         SELECT s.expires_at, s.status FROM subscriptions s
          WHERE s.user_id = u.id ORDER BY s.expires_at DESC LIMIT 1
       ) sub ON TRUE
      WHERE u.is_blocked = FALSE AND u.tg_unreachable = FALSE AND u.app_opened = TRUE
        AND ($1::boolean OR EXTRACT(HOUR FROM (NOW() AT TIME ZONE COALESCE(u.timezone,'Europe/Moscow')))::int = $2)`,
    [forceRun, cfg.send_hour]
  );

  let sent = 0, failed = 0, skipped = 0, blocked = 0;
  // Разбивка по поводам (ключи reminders.texts) — для сводки в канал логов.
  // Именно textsKey, а не plan.kind: в ручной рассылке kind'ы свои (manual_*), а повод тот же.
  const byKind = {};
  for (const r of rows) {
    // Предохранитель: не больше одного напоминания в сутки на человека
    // (ручная рассылка и вечерний крон не должны приходить в один день).
    if (r.reminded_recently) { skipped++; continue; }

    const row = { ...r, days_to_expiry: r.days_to_expiry === null ? null : Number(r.days_to_expiry), days_since_trial_start: Number(r.days_since_trial_start) };
    const plan = blast ? classifyBlast(row, cfg, trialDays, today) : classify(row, cfg, trialDays);
    if (!plan) { skipped++; continue; }

    // Дедуп: фиксируем стадию ДО отправки — одна попытка на стадию.
    const ins = await db.query(
      `INSERT INTO subscription_reminders (user_id, kind, stage, anchor_at)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
      [r.id, plan.kind, plan.stage, plan.anchor]
    );
    if (!ins.rows.length) { skipped++; continue; }

    const stats = await loadPersonalStats(r.id, r.tz);
    const data = {
      name: (r.name || "").trim() || null,
      trial_days: trialDays,
      ...stats,
      ...plan.extra
    };
    // В blast-режиме вариант текста крутим по дню месяца — повторные рассылки
    // в разные дни показывают разные тексты.
    const stageIndex = blast ? new Date().getDate() : plan.stageIndex;
    const text = pickTemplate(cfg.texts[plan.textsKey], r.id, stageIndex, data);
    if (!text) {
      // Стадия уже зафиксирована дедупом — без шаблонов она пропадёт молча,
      // поэтому оставляем след в логах (например, в админке стёрли все тексты).
      skipped++;
      console.warn(`[cron] subscriptionReminders: нет подходящего шаблона ${plan.kind}/${plan.stage} (user ${r.id}) — стадия пропущена`);
      continue;
    }

    const res = await sendMessage(r.telegram_id, text, {
      reply_markup: {
        inline_keyboard: [[{
          text: cfg.button_text || "Продлить подписку",
          url: `https://t.me/${BOT_USERNAME}?startapp=paywall`
        }]]
      }
    });
    if (res && res.mock) {
      skipped++;
    } else if (res && res.ok === false) {
      failed++;
      console.error(`[cron] subscriptionReminders send failed tg=${r.telegram_id} code=${res.error_code || "?"}: ${res.error || "unknown"}`);
      if (res.error_code === 403) {
        blocked++;
        await channelMembership.markUnreachable(r.id);
      }
    } else {
      sent++;
      byKind[plan.textsKey] = (byKind[plan.textsKey] || 0) + 1;
    }
  }
  console.log(`[cron] subscriptionReminders${blast ? " (blast)" : ""} -> sent=${sent} failed=${failed} blocked=${blocked} skipped=${skipped} (of ${rows.length})`);
  // Сводка в канал логов — общими цифрами по поводам, без перечисления людей.
  await notifyLog.subscriptionRun({ byKind, failed, blocked, blast })
    .catch((e) => console.error("[cron] subscriptionReminders log:", e.message));
  return { sent, failed, blocked, skipped, total: rows.length };
}

// Тестовое напоминание самому себе (кнопка «Проверить на себе» в админке):
// уходит ТОЛЬКО переданному пользователю (админу), реальных рассылок не трогает.
// Недостающие личные цифры заполняются образцами, чтобы был виден «полный» вид сообщения.
async function sendTestReminder({ kind, user }) {
  const cfg = await loadConfig();
  const templates = cfg.texts[kind];
  if (!Array.isArray(templates) || !templates.length) {
    return { ok: false, error: "no_templates" };
  }
  const trialDays = Number(await settings.get("trial_days")) || 3;
  const tz = user.timezone || "Europe/Moscow";

  let stats = {};
  try {
    stats = await loadPersonalStats(user.id, tz);
  } catch (e) {
    console.error("[reminders] test stats failed:", e.message);
  }
  const inThreeDays = new Date(Date.now() + 3 * 86400000);
  const data = {
    name: (user.name || "").trim() || "Дмитрий",
    trial_days: trialDays,
    meals_count: stats.meals_count ?? 47,
    days_tracked: stats.days_tracked ?? 12,
    weight_delta: stats.weight_delta ?? "−2,5 кг",
    days_left: 3,
    expires_date: fmtDate(inThreeDays, tz),
    // Только для «Не завершил оплату» — в тесте показываем образец тарифа и цены.
    tariff: "PRO",
    price: 150
  };
  // Случайная стадия — каждый клик показывает другой вариант текста.
  const text = pickTemplate(templates, user.id, Math.floor(Math.random() * 100), data);
  if (!text) return { ok: false, error: "no_templates" };

  // У догонялки по брошенной оплате своя кнопка — «Продлить» человеку без покупок не подходит.
  const buttonText = kind === "payment_abandoned"
    ? (cfg.abandoned_button_text || "Оформить подписку")
    : (cfg.button_text || "Продлить подписку");

  const res = await sendMessage(user.telegram_id, `🧪 Тест — так это увидит пользователь:\n\n${text}`, {
    reply_markup: {
      inline_keyboard: [[{
        text: buttonText,
        url: `https://t.me/${BOT_USERNAME}?startapp=paywall`
      }]]
    }
  });
  // В канал логов — только про реально ушедший тест (в mock-режиме отправки не было).
  if (res && res.ok !== false) notifyLog.test(user.id, kind).catch(() => {});
  return res;
}

module.exports = {
  subscriptionReminders,
  sendTestReminder,
  // Внутренности — для ручной проверки логики без БД (node -e / тесты)
  // и переиспользования в mealReminders (renderTemplate/pickTemplate/loadPersonalStats).
  _internal: { classify, classifyBlast, renderTemplate, pickTemplate, toDayList, formatWeightDelta, loadPersonalStats }
};
