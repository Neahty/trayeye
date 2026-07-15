// Анонс выката в канал логов.
//
// Вызывается на старте API: деплой перезапускает сервис (systemctl restart bytwise-api),
// так что «старт = выкат». Отличаем выкат от простого перезапуска по коммиту: если HEAD
// репозитория не менялся — сервис просто перезапустили (падение, ребут), и в канал не шлём.
//
// Текст: если в CHANGELOG.md появился новый блок — публикуем его целиком (это и есть
// пользовательский анонс обновы). Если анонса нет (правки внутренние) — короткая
// техническая строка, чтобы факт выката всё равно был виден в логах.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const settings = require("../utils/settings");
const channelLog = require("./channelLog");
const notify = require("./notify");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CHANGELOG_PATH = path.join(REPO_ROOT, "CHANGELOG.md");
const SHA_KEY = "last_deploy_sha";
const HASH_KEY = "last_changelog_hash";
const TG_TEXT_LIMIT = 4096;

// Текущий коммит и его заголовок. Локально/в тестах git может быть недоступен — тогда null,
// и анонс просто не уходит (в проде /opt/bytwise всегда git-репозиторий, см. deploy.sh).
function gitHead() {
  try {
    const g = (...args) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", timeout: 5000 }).trim();
    // «[deploy]» — служебная метка для GitHub Actions, в канале она ничего не значит.
    const subject = g("log", "-1", "--pretty=%s").replace(/^\s*\[deploy\]\s*/i, "");
    return { sha: g("rev-parse", "HEAD"), subject };
  } catch (err) {
    console.error("[deployNotice] git недоступен:", err.message);
    return null;
  }
}

// Свежий блок анонса: файл поделён строками-разделителями «---», сегмент 0 — шапка
// файла, сегмент 1 — самый свежий пост. Разделителем считается только строка ровно из
// «---»: внутри блоков есть строки вида «--- Например: …», и резать по ним нельзя.
// \s*$ — чтобы разделитель ловился и при CRLF-переводах строк.
function latestBlock(md) {
  const parts = md.split(/^---\s*$/m);
  return parts.length > 1 ? parts[1].trim() : "";
}

// Markdown блока → Telegram HTML. В блоках из конструкций только **жирный**,
// поэтому хватает экранирования и одной замены.
function toHtml(md) {
  return channelLog.esc(md).replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
}

function readChangelogBlock() {
  try {
    return latestBlock(fs.readFileSync(CHANGELOG_PATH, "utf8"));
  } catch (err) {
    console.error("[deployNotice] CHANGELOG.md не прочитан:", err.message);
    return "";
  }
}

async function announceDeploy() {
  const head = gitHead();
  if (!head) return;

  const prevSha = await settings.get(SHA_KEY);
  if (prevSha === head.sha) return; // тот же коммит — это перезапуск, а не выкат

  // Есть ли в CHANGELOG.md новый пользовательский анонс (не тот, что публиковали в прошлый раз).
  const block = readChangelogBlock();
  const blockHash = block ? crypto.createHash("sha1").update(block).digest("hex") : null;
  const prevHash = await settings.get(HASH_KEY);
  const isNewAnnounce = Boolean(block) && blockHash !== prevHash;

  let text = isNewAnnounce
    ? `🚀 <b>Обнова выкачена на сервер</b>\n\n${toHtml(block)}\n\nВремя: ${notify.fmtWhen()}`
    : `🚀 <b>Обнова выкачена на сервер</b>\n\n` +
      `Что нового: ${channelLog.esc(head.subject)}\n` +
      `<i>Правки внутренние — отдельного анонса для пользователей нет.</i>\n` +
      `Время: ${notify.fmtWhen()}`;
  if (text.length > TG_TEXT_LIMIT) text = text.slice(0, TG_TEXT_LIMIT - 1) + "…";

  const res = await channelLog.post("deploy", text);
  // Отправка сорвалась (бот не админ канала и т.п.) — ничего не запоминаем,
  // чтобы анонс ушёл со следующей попытки, а не потерялся навсегда.
  if (res?.ok === false) {
    console.error("[deployNotice] анонс не отправлен, отметки не сохраняю");
    return;
  }
  await settings.set(SHA_KEY, head.sha);
  if (isNewAnnounce) await settings.set(HASH_KEY, blockHash);
  console.log(`[deployNotice] анонс выката отправлен (${head.sha.slice(0, 7)}, анонс из CHANGELOG: ${isNewAnnounce})`);
}

module.exports = { announceDeploy, latestBlock, toHtml };
