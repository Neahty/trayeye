// Анонс обновления в канал логов при выкате.
//
// Источник текста — CHANGELOG.md (пользовательские анонсы, самый свежий блок сверху).
// Вызывается на старте API: деплой перезапускает сервис (systemctl restart bytwise-api),
// так что «старт = выкат». Идемпотентность обеспечивает не место вызова, а хэш блока —
// перезапуск без нового анонса в канал ничего не шлёт.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const settings = require("../utils/settings");
const channelLog = require("./channelLog");
const notify = require("./notify");

const CHANGELOG_PATH = path.resolve(__dirname, "../../../CHANGELOG.md");
const HASH_KEY = "last_changelog_hash";
const TG_TEXT_LIMIT = 4096;

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

async function announceDeploy() {
  let md;
  try {
    md = fs.readFileSync(CHANGELOG_PATH, "utf8");
  } catch (err) {
    console.error("[deployNotice] CHANGELOG.md не прочитан:", err.message);
    return;
  }

  const block = latestBlock(md);
  if (!block) return;
  const hash = crypto.createHash("sha1").update(block).digest("hex");

  const prev = await settings.get(HASH_KEY);
  if (prev === hash) return; // тот же анонс уже публиковали

  // Первый запуск с этой фичей: анонса ещё не было ни разу. Молча запоминаем текущий
  // блок, иначе в канал улетит уже неактуальный пост из истории. Первый настоящий
  // анонс придёт со следующим выкатом, где CHANGELOG.md изменится.
  if (!prev) {
    await settings.set(HASH_KEY, hash);
    console.log("[deployNotice] первый запуск — запомнил текущий анонс, в канал не шлю");
    return;
  }

  let text = `${toHtml(block)}\n\nВремя: ${notify.fmtWhen()}`;
  if (text.length > TG_TEXT_LIMIT) text = text.slice(0, TG_TEXT_LIMIT - 1) + "…";
  const res = await channelLog.post("deploy", text);
  // Хэш пишем только после успешной отправки: если канал выключен или бот не админ,
  // анонс должен уйти со следующей попытки, а не потеряться навсегда.
  if (res?.ok === false) {
    console.error("[deployNotice] анонс не отправлен, хэш не сохраняю");
    return;
  }
  await settings.set(HASH_KEY, hash);
  console.log("[deployNotice] анонс обновления отправлен в канал");
}

module.exports = { announceDeploy, latestBlock, toHtml };
