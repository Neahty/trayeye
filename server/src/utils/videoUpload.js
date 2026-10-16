// Приём видео с камеры (routes/director.js, демо камеры).
//
// Как и с картинками (utils/imageUpload.js): тип сверяем с белым списком, а расширение
// на диске берём ИЗ СПИСКА, а не из присланного Content-Type. Видео пишется на диск,
// а не в память: файл до 200 МБ, а сервер маленький. Папка входящих не раздаётся,
// после разбора файл удаляется.

const crypto = require("crypto");
const fs = require("fs");
const multer = require("multer");

const ALLOWED = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv"
};

function videoFileFilter(req, file, cb) {
  if (Object.prototype.hasOwnProperty.call(ALLOWED, String(file.mimetype || "").toLowerCase())) return cb(null, true);
  const err = new Error("unsupported_video_type");
  err.code = "UNSUPPORTED_VIDEO_TYPE";
  cb(err);
}

function videoUpload(maxBytes, dir) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir)),
      filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ALLOWED[file.mimetype.toLowerCase()]}`)
    }),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: videoFileFilter
  });
}

function videoErrors(err, req, res, next) {
  if (err && err.code === "UNSUPPORTED_VIDEO_TYPE") return res.status(400).json({ error: "unsupported_video_type" });
  if (err && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "file_too_large" });
  return next(err);
}

module.exports = { ALLOWED, videoUpload, videoErrors };
