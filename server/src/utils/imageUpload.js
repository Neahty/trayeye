// Приём картинок от пользователя: аватар (routes/profile.js) и фото еды (routes/scan.js).
//
// Почему расширение НЕЛЬЗЯ брать из req.file.mimetype: mimetype — это заголовок Content-Type
// части multipart, его целиком задаёт клиент. Раньше расширение выводилось из него напрямую
// (`mimetype.split("/")[1]`), а загруженное раздаётся через express.static с того же домена,
// что клиент и админка. Аватар с Content-Type: text/html сохранялся как .html, отдавался
// браузеру как text/html и выполнялся как JS на боевом origin — то есть чужой скрипт получал
// доступ к админскому токену. CSP при этом выключен (app.js), так что ничто это не ловило.
//
// Поэтому: mime сверяется с белым списком, а расширение берётся ИЗ ЭТОГО СПИСКА, а не из
// присланной строки. Что бы клиент ни прислал, на диск попадёт .jpg/.png/.webp/.heic, и
// раздача проставит image/*, который браузер не исполняет.
//
// SVG в списке намеренно нет: image/svg+xml — исполняемый формат, он вернул бы ту же дыру.

const multer = require("multer");

// mime -> расширение на диске. Ключи — то, что реально шлют браузеры и Telegram-клиенты.
const ALLOWED = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif"
};

function isAllowedMime(mime) {
  return Object.prototype.hasOwnProperty.call(ALLOWED, String(mime || "").toLowerCase());
}

// Расширение для сохранения. Только из белого списка; для всего остального — jpg.
// Вызывать имеет смысл лишь после fileFilter, но дефолт оставлен на случай прямого вызова.
function extFor(mime) {
  return ALLOWED[String(mime || "").toLowerCase()] || "jpg";
}

// multer.fileFilter: не-картинку отклоняем на входе, до записи на диск.
// Ошибку помечаем кодом, чтобы обработчик роута отличил её от внутреннего сбоя и ответил 400.
function imageFileFilter(req, file, cb) {
  if (isAllowedMime(file.mimetype)) return cb(null, true);
  const err = new Error("unsupported_image_type");
  err.code = "UNSUPPORTED_IMAGE_TYPE";
  cb(err);
}

// Готовый multer для картинок: память + белый список + лимит размера.
function imageUpload(maxBytes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: imageFileFilter
  });
}

// Ошибки приёма файла — это ошибки ввода, а не сбой сервера: без этого обработчика
// отказ фильтра и превышение размера уезжали бы в глобальный next(err) и отдавали 500.
// Ставится в цепочке роута сразу после .single(): express распознаёт 4-арную сигнатуру.
function uploadErrors(err, req, res, next) {
  if (err && err.code === "UNSUPPORTED_IMAGE_TYPE") {
    return res.status(400).json({ error: "unsupported_image_type" });
  }
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "file_too_large" });
  }
  return next(err);
}

module.exports = { ALLOWED, isAllowedMime, extFor, imageFileFilter, imageUpload, uploadErrors };
