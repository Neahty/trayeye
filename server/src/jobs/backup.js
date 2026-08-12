const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const { sendDocument } = require("../services/bot");
const { sendMessage } = require("../services/telegram");

// Авто-бэкап базы: pg_dump -> gzip -> файл на диске -> отправка админам в Telegram.
// Telegram хранит файл в облаке, поэтому копия живёт ОТДЕЛЬНО от сервера —
// если сервер удалят, бэкап остаётся в чате у админов.
//
// Дамп пишется ПОТОКОМ в файл, а не собирается в памяти. Раньше весь дамп жил в
// Buffer.concat, а gzipSync делал вторую копию и БЛОКИРОВАЛ event loop — в полночь
// все запросы к API вставали, а с ростом базы бэкап грозил уронить прод по памяти.
//
// Локальная копия с ретеншеном нужна потому, что Telegram был ЕДИНСТВЕННЫМ местом
// хранения: при лимите sendDocument в 50 МБ переросшая база означала бы, что бэкапов
// нет вообще, и заметить это можно было только по сообщению об ошибке.
const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(__dirname, "../../../backups");
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 14);
const TG_DOC_LIMIT = 50 * 1024 * 1024;

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
// На Linux (боевой сервер) перебор Windows-путей бессмысленен — сразу берём PATH.
function resolvePgDump() {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  if (process.platform !== "win32") return "pg_dump";
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

// Пишет сжатый дамп прямо в файл: pg_dump -> gzip -> диск, всё потоком.
// В память при этом не попадает ни дамп, ни его копия, и event loop не блокируется.
async function dumpToFile(filePath) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const bin = resolvePgDump();
  // --no-owner/--no-privileges — чтобы дамп восстанавливался под любым пользователем.
  const proc = spawn(bin, ["--no-owner", "--no-privileges", url], { windowsHide: true });

  const err = [];
  proc.stderr.on("data", (d) => err.push(d));

  const exited = new Promise((resolve, reject) => {
    proc.on("error", (e) => reject(new Error(`не удалось запустить ${bin}: ${e.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`pg_dump завершился с кодом ${code}: ${Buffer.concat(err).toString().slice(0, 500)}`));
      }
      resolve();
    });
  });

  try {
    await Promise.all([
      pipeline(proc.stdout, zlib.createGzip(), fs.createWriteStream(filePath)),
      exited
    ]);
  } catch (e) {
    // Недописанный файл не должен выглядеть как валидный бэкап.
    await fs.promises.rm(filePath, { force: true }).catch(() => {});
    throw e;
  }
}

// Чистка старых копий: держим на диске последние RETENTION_DAYS дней.
async function pruneOldBackups() {
  let files;
  try {
    files = await fs.promises.readdir(BACKUP_DIR);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  let removed = 0;
  for (const name of files) {
    if (!name.startsWith("calorieyka_") || !name.endsWith(".sql.gz")) continue;
    const full = path.join(BACKUP_DIR, name);
    try {
      const st = await fs.promises.stat(full);
      if (st.mtimeMs < cutoff) {
        await fs.promises.unlink(full);
        removed++;
      }
    } catch { /* файл уже удалён — не мешает */ }
  }
  return removed;
}

async function backupDatabase() {
  const ids = adminIds();
  const stamp = mskDateStamp();
  const filename = `calorieyka_${stamp}.sql.gz`;
  const filePath = path.join(BACKUP_DIR, filename);

  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    await dumpToFile(filePath);
    const { size } = await fs.promises.stat(filePath);

    // Локальная копия уже есть — это главное. Отправка в Telegram отсюда необязательна.
    const removed = await pruneOldBackups();
    console.log(`[cron] backupDatabase -> ${filePath} (${size} B), удалено старых: ${removed}`);

    if (!ids.length) {
      console.warn("[cron] backupDatabase: нет ADMIN_TELEGRAM_IDS — копия только на диске");
      return;
    }

    const caption =
      `🗄 Бэкап базы Bytwise — ${stamp} (00:00 МСК)\n` +
      `Размер: ${(size / 1024).toFixed(0)} КБ\n` +
      `Копия на сервере: ${filePath} (хранится ${RETENTION_DAYS} дн.)\n` +
      `Восстановление: gunzip -c ${filename} | psql -U calorie -h localhost -d calorieyka`;

    if (size > TG_DOC_LIMIT) {
      // Раньше это был бы полный отказ бэкапа; теперь копия на диске цела, а админам
      // уходит внятное предупреждение, что облачное дублирование больше не работает.
      const warn =
        `⚠️ Бэкап базы (${(size / 1024 / 1024).toFixed(1)} МБ) превысил лимит Telegram в 50 МБ ` +
        `и НЕ отправлен в чат.\nКопия на сервере: ${filePath}\n` +
        `Нужно настроить выгрузку во внешнее хранилище.`;
      for (const id of ids) {
        try { await sendMessage(id, warn); } catch { /* skip */ }
      }
      return;
    }

    const gz = await fs.promises.readFile(filePath);
    let sent = 0;
    for (const id of ids) {
      try {
        await sendDocument(id, gz, filename, caption);
        sent++;
      } catch (e) {
        console.error(`[cron] backup send failed tg=${id}: ${e.message}`);
      }
    }
    console.log(`[cron] backupDatabase отправлен ${sent}/${ids.length}`);
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
