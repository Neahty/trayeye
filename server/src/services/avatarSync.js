const fs = require("fs");
const path = require("path");
const db = require("../db");
const telegram = require("./telegram");

const UPLOADS_ROOT = path.resolve(__dirname, "../../../uploads");
// Как часто перепроверять аватарку в Telegram (пользователь мог её сменить).
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

// Абсолютный путь к файлу по относительному avatar-path вида "uploads/users/<id>/<file>".
function absFromRel(rel) {
  if (!rel) return null;
  return path.resolve(UPLOADS_ROOT, "..", rel.replace(/^\/+/, ""));
}

function fileExists(rel) {
  const abs = absFromRel(rel);
  try { return Boolean(abs) && fs.existsSync(abs); } catch { return false; }
}

// Скачивает и кэширует аватарку пользователя из Telegram в наши uploads.
// Идемпотентно и «дёшево»: работает только если кэш отсутствует/битый или устарел.
// Ошибки не пробрасываются — аватар не критичен для входа (fire-and-forget).
//
// user — строка из БД (нужны id, telegram_id, tg_photo_path, tg_photo_synced_at).
async function syncTelegramAvatar(user) {
  try {
    if (!telegram.BOT_TOKEN || !user || !user.telegram_id) return null;

    const cachedOk = user.tg_photo_path && fileExists(user.tg_photo_path);
    const fresh = user.tg_photo_synced_at &&
      Date.now() - new Date(user.tg_photo_synced_at).getTime() < REFRESH_MS;
    // Есть валидный и свежий кэш — ничего не делаем.
    if (cachedOk && fresh) return user.tg_photo_path;

    const fileId = await telegram.getUserProfilePhotoFileId(user.telegram_id);
    if (!fileId) {
      // Фото в Telegram нет (закрытый профиль/не задано). Отметим попытку, чтобы
      // не дёргать Bot API на каждый вход; кэш (если был валиден) оставим как есть.
      await db.query("UPDATE users SET tg_photo_synced_at = NOW() WHERE id = $1", [user.id]);
      return cachedOk ? user.tg_photo_path : null;
    }

    const filePath = await telegram.getFilePath(fileId);
    const buf = filePath ? await telegram.downloadFile(filePath) : null;
    if (!buf || !buf.length) {
      await db.query("UPDATE users SET tg_photo_synced_at = NOW() WHERE id = $1", [user.id]);
      return cachedOk ? user.tg_photo_path : null;
    }

    const ext = (path.extname(filePath || "").replace(".", "") || "jpg").toLowerCase();
    const dir = path.join(UPLOADS_ROOT, "users", String(user.id));
    fs.mkdirSync(dir, { recursive: true });
    const filename = `tg_avatar.${ext}`;
    fs.writeFileSync(path.join(dir, filename), buf);
    const rel = `uploads/users/${user.id}/${filename}`;

    await db.query(
      "UPDATE users SET tg_photo_path = $2, tg_photo_synced_at = NOW() WHERE id = $1",
      [user.id, rel]
    );
    return rel;
  } catch (err) {
    console.error("[avatarSync] failed:", err.message);
    return null;
  }
}

module.exports = { syncTelegramAvatar };
