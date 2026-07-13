const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { sendDocument } = require("../services/bot");
const { sendMessage } = require("../services/telegram");

// Авто-бэкап базы: pg_dump -> gzip -> отправка файла админам в Telegram.
// Telegram хранит файл в облаке, поэтому копия живёт ОТДЕЛЬНО от сервера —
// если сервер удалят, бэкап остаётся в чате у админов.

function adminIds() {
  return (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// YYYY-MM-DD в часовом поясе МСК (sv-SE даёт ISO-формат даты)
function mskDateStamp() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

// Находит pg_dump: явный PG_DUMP → авто-поиск в стандартных папках PostgreSQL
// на Windows (берём самую новую версию) → иначе надеемся, что он в PATH.
function resolvePgDump() {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  const roots = ["C:\\Program Files\\PostgreSQL", "C:\\Program Files (x86)\\PostgreSQL"];
  let best = null, bestVer = -1;
  for (const root of roots) {
    let versions;
    try { versions = fs.readdirSync(root); } catch { continue; }
    for (const v of versions) {
      const exe = path.join(root, v, "bin", "pg_dump.exe");
      const num = parseInt(v, 10);
      if (Number.isFinite(num) && num > bestVer && fs.existsSync(exe)) {
        best = exe; bestVer = num;
      }
    }
  }
  return best || "pg_dump";
}

// Запускает pg_dump и возвращает дамп как Buffer (plain SQL).
function dumpDatabase() {
  return new Promise((resolve, reject) => {
    const url = process.env.DATABASE_URL;
    if (!url) return reject(new Error("DATABASE_URL не задан"));
    const bin = resolvePgDump();
    // --no-owner/--no-privileges — чтобы дамп восстанавливался под любым пользователем.
    const proc = spawn(bin, ["--no-owner", "--no-privileges", url], { windowsHide: true });

    const out = [];
    const err = [];
    proc.stdout.on("data", (d) => out.push(d));
    proc.stderr.on("data", (d) => err.push(d));
    proc.on("error", (e) => reject(new Error(`не удалось запустить ${bin}: ${e.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`pg_dump завершился с кодом ${code}: ${Buffer.concat(err).toString().slice(0, 500)}`));
      }
      resolve(Buffer.concat(out));
    });
  });
}

async function backupDatabase() {
  const ids = adminIds();
  if (!ids.length) {
    console.warn("[cron] backupDatabase: нет ADMIN_TELEGRAM_IDS — некому слать");
    return;
  }
  try {
    const sql = await dumpDatabase();
    const gz = zlib.gzipSync(sql);
    const stamp = mskDateStamp();
    const filename = `calorieyka_${stamp}.sql.gz`;
    const caption =
      `🗄 Бэкап базы Bytwise — ${stamp} (00:00 МСК)\n` +
      `Размер: ${(gz.length / 1024).toFixed(0)} КБ\n` +
      `Восстановление: распаковать gzip и выполнить\n` +
      `psql -U calorie -h localhost -d calorieyka -f calorieyka_${stamp}.sql`;

    let sent = 0;
    for (const id of ids) {
      try {
        await sendDocument(id, gz, filename, caption);
        sent++;
      } catch (e) {
        console.error(`[cron] backup send failed tg=${id}: ${e.message}`);
      }
    }
    console.log(`[cron] backupDatabase -> ${filename} (${gz.length} B) sent=${sent}/${ids.length}`);
  } catch (e) {
    console.error(`[cron] backupDatabase FAILED: ${e.message}`);
    // Уведомляем админов, чтобы провал бэкапа не остался незамеченным.
    for (const id of ids) {
      try {
        await sendMessage(id, `⚠️ Авто-бэкап базы Bytwise не удался:\n${e.message}`);
      } catch { /* skip */ }
    }
  }
}

module.exports = { backupDatabase };
