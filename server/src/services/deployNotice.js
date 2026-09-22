// Анонс выката в канал логов.
//
// Вызывается на старте API: деплой перезапускает сервис (systemctl restart bytwise-api),
// так что «старт = выкат». Отличаем выкат от простого перезапуска по коммиту: если HEAD
// репозитория не менялся - сервис просто перезапустили (падение, ребут), и в канал не шлём.
//
// Текст: если в CHANGELOG.md появился новый блок - публикуем его целиком (это и есть
// пользовательский анонс обновы). Если анонса нет (правки внутренние) - короткая
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

// safe.directory обязателен: на проде репозиторий принадлежит пользователю deploy,
// а сервис работает от bytwise - без этого git отказывается читать «чужой» репозиторий
// («detected dubious ownership») и анонс молча не уходит.
function git(...args) {
  return execFileSync("git", ["-c", `safe.directory=${REPO_ROOT}`, "-C", REPO_ROOT, ...args],
    { encoding: "utf8", timeout: 5000 }).trim();
}

// Развёрнутый сейчас коммит. Если git по любой причине недоступен - читаем .git напрямую:
// от бинарника git зависеть не хотим, без коммита анонса не будет вовсе.
function headSha() {
  try { return git("rev-parse", "HEAD"); } catch { /* пробуем прочитать .git сами */ }
  try {
    const head = fs.readFileSync(path.join(REPO_ROOT, ".git", "HEAD"), "utf8").trim();
    const ref = /^ref:\s*(.+)$/.exec(head);
    if (!ref) return head; // detached HEAD - там сразу sha
    const direct = path.join(REPO_ROOT, ".git", ref[1]);
    if (fs.existsSync(direct)) return fs.readFileSync(direct, "utf8").trim();
    const packed = fs.readFileSync(path.join(REPO_ROOT, ".git", "packed-refs"), "utf8");
    return packed.split("\n").find((l) => l.endsWith(` ${ref[1]}`))?.split(" ")[0] || null;
  } catch (err) {
    console.error("[deployNotice] не удалось определить коммит:", err.message);
    return null;
  }
}

// Заголовок коммита - необязателен: не прочитался, значит просто не пишем «Что поправили».
// --no-merges обязателен: авто-деплой вливает ветку в master, и HEAD - это merge-коммит
// («Merge remote-tracking branch ...»). Такую строку в канал выкладывать нельзя, там не
// разработчики. Берём последний осмысленный коммит.
// «[deploy]» - служебная метка для GitHub Actions, в канале она ничего не значит.
function headSubject() {
  try {
    const s = git("log", "-1", "--no-merges", "--pretty=%s").replace(/\s*\[deploy\]\s*/i, " ").trim();
    return s || null;
  } catch (err) {
    console.error("[deployNotice] заголовок коммита не прочитан:", err.message);
    return null;
  }
}

// Свежий блок анонса: файл поделён строками-разделителями «---», сегмент 0 - шапка
// файла, сегмент 1 - самый свежий пост. Разделителем считается только строка ровно из
// «---»: внутри блоков есть строки вида «--- Например: …», и резать по ним нельзя.
// \s*$ - чтобы разделитель ловился и при CRLF-переводах строк.
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
  const sha = headSha();
  if (!sha) return; // без коммита не отличить выкат от перезапуска - молчим, чтобы не спамить

  const prevSha = await settings.get(SHA_KEY);
  if (prevSha === sha) return; // тот же коммит - это перезапуск, а не выкат

  // Есть ли в CHANGELOG.md новый пользовательский анонс (не тот, что публиковали в прошлый раз).
  const block = readChangelogBlock();
  const blockHash = block ? crypto.createHash("sha1").update(block).digest("hex") : null;
  const prevHash = await settings.get(HASH_KEY);
  const isNewAnnounce = Boolean(block) && blockHash !== prevHash;

  const subject = isNewAnnounce ? null : headSubject();
  let text = isNewAnnounce
    ? `🚀 <b>Обнова выкачена на сервер</b>\n\n${toHtml(block)}\n\nВремя: ${notify.fmtWhen()}`
    : `🚀 <b>Обнова выкачена на сервер</b>\n\n` +
      (subject ? `Что поправили: ${channelLog.esc(subject)}\n\n` : "") +
      `<i>Техническая правка - в приложении пользователи ничего нового не увидят.</i>\n` +
      `Время: ${notify.fmtWhen()}`;
  if (text.length > TG_TEXT_LIMIT) text = text.slice(0, TG_TEXT_LIMIT - 1) + "…";

  const res = await channelLog.post("deploy", text);
  // Отправка сорвалась (бот не админ канала и т.п.) - ничего не запоминаем,
  // чтобы анонс ушёл со следующей попытки, а не потерялся навсегда.
  if (res?.ok === false) {
    console.error("[deployNotice] анонс не отправлен, отметки не сохраняю");
    return;
  }
  await settings.set(SHA_KEY, sha);
  if (isNewAnnounce) await settings.set(HASH_KEY, blockHash);
  console.log(`[deployNotice] анонс выката отправлен (${sha.slice(0, 7)}, анонс из CHANGELOG: ${isNewAnnounce})`);
}

module.exports = { announceDeploy, latestBlock, toHtml };
