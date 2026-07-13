// Разовый maintenance для исправления исторических данных Bytwise.
//
// Запуск (из папки server, внутри контейнера или локально):
//   node scripts/maintenance.js <команда>            — DRY-RUN: только показывает, что изменится
//   node scripts/maintenance.js <команда> --apply     — выполняет изменения
//
// Команды:
//   dedupe-subs               удалить точные дубли подписок и погасить лишние active
//   dedupe-payments           удалить дубли succeeded-платежей (двойной вебхук / та же минута)
//   backfill-manual-payments  создать платёж для ручных подписок без succeeded-платежа
//   reclassify-meals          пересчитать meal_type по локальному часу scanned_at
//   reset-auto-blocks         снять is_blocked у НЕ-админов (последствие старого 403-бага)
//   reset-billing             УДАЛИТЬ все платежи и подписки (обнуляет «Заработано всего»)
//   all                       выполнить все команды по очереди
//
// ВАЖНО: перед --apply сделай бэкап БД (у проекта есть авто-бэкап в 00:00 МСК).

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const db = require("../src/db");
const settings = require("../src/utils/settings");

const APPLY = process.argv.includes("--apply");
const tag = () => (APPLY ? "[APPLY]" : "[DRY-RUN]");

async function tariffPrice(type) {
  const key = type === "trainer" ? "sub_price_trainer" : "sub_price_basic";
  const val = Number(await settings.get(key));
  return Number.isFinite(val) && val > 0 ? val : type === "trainer" ? 1799 : 349;
}

// 1) Дедупликация подписок ---------------------------------------------------
async function dedupeSubs() {
  console.log(`\n=== dedupe-subs ${tag()} ===`);

  // a) точные дубли: одинаковые user_id,type,started_at,expires_at — оставляем минимальный id
  const dups = await db.query(
    `SELECT user_id, type, started_at, expires_at, COUNT(*)::int AS c, MIN(id) AS keep_id
       FROM subscriptions
      GROUP BY user_id, type, started_at, expires_at
     HAVING COUNT(*) > 1`
  );
  let dupRows = 0;
  for (const d of dups.rows) dupRows += d.c - 1;
  console.log(`Точных дублей: ${dups.rows.length} групп, лишних строк к удалению: ${dupRows}`);
  if (APPLY && dups.rows.length) {
    const res = await db.query(
      `DELETE FROM subscriptions s
        WHERE EXISTS (
          SELECT 1 FROM subscriptions s2
           WHERE s2.user_id = s.user_id AND s2.type = s.type
             AND s2.started_at IS NOT DISTINCT FROM s.started_at
             AND s2.expires_at IS NOT DISTINCT FROM s.expires_at
             AND s2.id < s.id
        )`
    );
    console.log(`  удалено дублей: ${res.rowCount}`);
  }

  // b) несколько active у одного пользователя — оставляем самую позднюю по expires_at
  const multiActive = await db.query(
    `SELECT user_id, COUNT(*)::int AS c
       FROM subscriptions WHERE status='active'
      GROUP BY user_id HAVING COUNT(*) > 1`
  );
  console.log(`Пользователей с >1 active: ${multiActive.rows.length}`);
  if (APPLY && multiActive.rows.length) {
    const res = await db.query(
      `UPDATE subscriptions s SET status='cancelled', auto_renew=FALSE
        WHERE s.status='active'
          AND EXISTS (
            SELECT 1 FROM subscriptions s2
             WHERE s2.user_id = s.user_id AND s2.status='active'
               AND (s2.expires_at > s.expires_at
                    OR (s2.expires_at = s.expires_at AND s2.id > s.id))
          )`
    );
    console.log(`  погашено лишних active: ${res.rowCount}`);
  }
}

// 1.5) Дедупликация платежей -------------------------------------------------
async function dedupePayments() {
  console.log(`\n=== dedupe-payments ${tag()} ===`);

  // a) точные дубли вебхука: одинаковый yukassa_id у succeeded — оставляем минимальный id
  const byId = await db.query(
    `SELECT yukassa_id, COUNT(*)::int AS c
       FROM payments WHERE status='succeeded' AND yukassa_id IS NOT NULL
      GROUP BY yukassa_id HAVING COUNT(*) > 1`
  );
  let byIdExtra = 0;
  for (const r of byId.rows) byIdExtra += r.c - 1;
  console.log(`Дублей по yukassa_id: ${byId.rows.length} групп, лишних строк: ${byIdExtra}`);
  if (APPLY && byId.rows.length) {
    const res = await db.query(
      `DELETE FROM payments p
        WHERE p.status='succeeded' AND p.yukassa_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM payments p2
             WHERE p2.yukassa_id = p.yukassa_id AND p2.status='succeeded' AND p2.id < p.id
          )`
    );
    console.log(`  удалено: ${res.rowCount}`);
  }

  // b) дубли «тот же платёж в ту же минуту»: один user_id, сумма, тариф, статус и created_at
  //    с точностью до минуты (артефакт двойного вебхука с разными id). Оставляем минимальный id.
  const byContent = await db.query(
    `SELECT user_id, amount, COALESCE(sub_type,'basic') AS st,
            date_trunc('minute', created_at) AS minute, COUNT(*)::int AS c
       FROM payments WHERE status='succeeded'
      GROUP BY user_id, amount, COALESCE(sub_type,'basic'), date_trunc('minute', created_at)
     HAVING COUNT(*) > 1`
  );
  let byContentExtra = 0;
  for (const r of byContent.rows) {
    byContentExtra += r.c - 1;
    console.log(`  user=${r.user_id} amount=${r.amount} ${r.st} @ ${new Date(r.minute).toISOString()} ×${r.c}`);
  }
  console.log(`Дублей по содержимому/минуте: ${byContent.rows.length} групп, лишних строк: ${byContentExtra}`);
  if (APPLY && byContent.rows.length) {
    const res = await db.query(
      `DELETE FROM payments p
        WHERE p.status='succeeded'
          AND EXISTS (
            SELECT 1 FROM payments p2
             WHERE p2.status='succeeded' AND p2.user_id = p.user_id
               AND p2.amount = p.amount
               AND COALESCE(p2.sub_type,'basic') = COALESCE(p.sub_type,'basic')
               AND date_trunc('minute', p2.created_at) = date_trunc('minute', p.created_at)
               AND p2.id < p.id
          )`
    );
    console.log(`  удалено: ${res.rowCount}`);
  }
}

// 2) Бэкфилл ручных платежей -------------------------------------------------
async function backfillManualPayments() {
  console.log(`\n=== backfill-manual-payments ${tag()} ===`);
  // ручные подписки, у которых НЕТ ни одного succeeded-платежа того же типа
  const subs = await db.query(
    `SELECT s.id, s.user_id, s.type, s.started_at
       FROM subscriptions s
      WHERE s.method = 'manual'
        AND NOT EXISTS (
          SELECT 1 FROM payments p
           WHERE p.user_id = s.user_id AND p.status='succeeded'
             AND COALESCE(p.sub_type, 'basic') = COALESCE(s.type, 'basic')
        )
      ORDER BY s.started_at`
  );
  console.log(`Ручных подписок без платежа: ${subs.rows.length}`);
  let total = 0;
  for (const s of subs.rows) {
    const amount = await tariffPrice(s.type || "basic");
    total += amount;
    console.log(`  user=${s.user_id} type=${s.type} amount=${amount} date=${s.started_at && new Date(s.started_at).toISOString()}`);
    if (APPLY) {
      await db.query(
        `INSERT INTO payments (user_id, amount, status, yukassa_id, method, sub_type, created_at)
         VALUES ($1,$2,'succeeded',$3,'manual',$4,COALESCE($5, NOW()))`,
        [s.user_id, amount, "manual_backfill_" + s.id, s.type || "basic", s.started_at]
      );
    }
  }
  console.log(`Итого к выручке: ${total} ₽${APPLY ? " (записано)" : " (предпросмотр)"}`);
}

// 3) Пересчёт meal_type по локальному часу -----------------------------------
function mealByHour(h) {
  if (h >= 5 && h < 11) return "breakfast";
  if (h >= 11 && h < 16) return "lunch";
  if (h >= 16 && h < 22) return "dinner";
  return "snack";
}
async function reclassifyMeals() {
  console.log(`\n=== reclassify-meals ${tag()} ===`);
  const rows = await db.query(
    `SELECT s.id, s.meal_type,
            EXTRACT(HOUR FROM (s.scanned_at AT TIME ZONE COALESCE(u.timezone,'Europe/Moscow')))::int AS h
       FROM scans s JOIN users u ON u.id = s.user_id`
  );
  const counts = {};
  const updates = [];
  for (const r of rows.rows) {
    const want = mealByHour(r.h);
    if (want !== r.meal_type) {
      counts[`${r.meal_type || "—"}→${want}`] = (counts[`${r.meal_type || "—"}→${want}`] || 0) + 1;
      updates.push([r.id, want]);
    }
  }
  console.log(`Сканов всего: ${rows.rows.length}, сменят тип: ${updates.length}`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  if (APPLY && updates.length) {
    for (const [id, want] of updates) {
      await db.query("UPDATE scans SET meal_type = $2 WHERE id = $1", [id, want]);
    }
    console.log(`  обновлено сканов: ${updates.length}`);
  }
}

// 4) Сброс авто-блокировок ---------------------------------------------------
async function resetAutoBlocks() {
  console.log(`\n=== reset-auto-blocks ${tag()} ===`);
  const sel = await db.query(
    "SELECT id, telegram_id, username FROM users WHERE is_blocked = TRUE AND is_admin = FALSE"
  );
  console.log(`Заблокированных НЕ-админов: ${sel.rows.length}`);
  for (const u of sel.rows) console.log(`  user=${u.id} tg=${u.telegram_id} ${u.username || ""}`);
  if (APPLY && sel.rows.length) {
    const res = await db.query("UPDATE users SET is_blocked = FALSE WHERE is_blocked = TRUE AND is_admin = FALSE");
    console.log(`  разблокировано: ${res.rowCount}`);
  }
}

// 5) Полный сброс биллинга ---------------------------------------------------
// Удаляет ВСЕ платежи и подписки. «Заработано всего» = SUM(amount) succeeded → станет 0.
// На payments/subscriptions нет внешних ссылок (FK), удаление безопасно.
async function resetBilling() {
  console.log(`\n=== reset-billing ${tag()} ===`);
  const [pc] = (await db.query("SELECT COUNT(*)::int AS c FROM payments")).rows;
  const [sc] = (await db.query("SELECT COUNT(*)::int AS c FROM subscriptions")).rows;
  const [sum] = (await db.query("SELECT COALESCE(SUM(amount),0)::int AS s FROM payments WHERE status='succeeded'")).rows;
  console.log(`Платежей: ${pc.c} (succeeded на сумму ${sum.s} ₽), подписок: ${sc.c}`);
  if (APPLY) {
    const p = await db.query("DELETE FROM payments");
    const s = await db.query("DELETE FROM subscriptions");
    console.log(`  удалено платежей: ${p.rowCount}, подписок: ${s.rowCount}. «Заработано всего» теперь 0 ₽.`);
  }
}

const COMMANDS = {
  "dedupe-subs": dedupeSubs,
  "dedupe-payments": dedupePayments,
  "backfill-manual-payments": backfillManualPayments,
  "reclassify-meals": reclassifyMeals,
  "reset-auto-blocks": resetAutoBlocks,
  "reset-billing": resetBilling
};

(async () => {
  const cmd = process.argv[2];
  try {
    if (cmd === "all") {
      // reset-billing деструктивен и в «all» не входит — запускается только явно
      for (const [name, fn] of Object.entries(COMMANDS)) {
        if (name === "reset-billing") continue;
        await fn();
      }
    } else if (COMMANDS[cmd]) {
      await COMMANDS[cmd]();
    } else {
      console.log("Команды: " + Object.keys(COMMANDS).join(", ") + ", all");
      console.log("Добавь --apply, чтобы применить изменения (по умолчанию dry-run).");
      process.exitCode = 1;
    }
    if (!APPLY && COMMANDS[cmd]) console.log(`\n(DRY-RUN — ничего не изменено. Повтори с --apply.)`);
  } catch (err) {
    console.error("Ошибка:", err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
