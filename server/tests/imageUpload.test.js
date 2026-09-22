const { isAllowedMime, extFor, imageFileFilter } = require("../src/utils/imageUpload");

// Эти проверки существуют из-за конкретной дыры: расширение файла бралось из
// req.file.mimetype, который задаёт клиент. Аватар с Content-Type: text/html сохранялся
// как .html и выполнялся как скрипт на боевом домене админки. Если кто-то снова начнёт
// доверять присланному mime, упадёт этот тест.
describe("imageUpload - расширение не доверяет клиенту", () => {
  test("исполняемые типы отклоняются", () => {
    for (const mime of ["text/html", "image/svg+xml", "application/javascript", "text/plain", ""]) {
      expect(isAllowedMime(mime)).toBe(false);
    }
  });

  test("картинки принимаются, регистр не важен", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "IMAGE/PNG"]) {
      expect(isAllowedMime(mime)).toBe(true);
    }
  });

  test("расширение всегда из белого списка, а не из присланной строки", () => {
    expect(extFor("image/jpeg")).toBe("jpg");
    expect(extFor("image/png")).toBe("png");
    // Главное: что бы ни прислали, на диск не попадёт исполняемое расширение.
    for (const mime of ["text/html", "image/svg+xml", "application/x-httpd-php", undefined]) {
      expect(["jpg", "png", "webp", "heic", "heif"]).toContain(extFor(mime));
    }
  });

  test("fileFilter пропускает картинку и отклоняет html", () => {
    const ok = jest.fn();
    imageFileFilter({}, { mimetype: "image/jpeg" }, ok);
    expect(ok).toHaveBeenCalledWith(null, true);

    const bad = jest.fn();
    imageFileFilter({}, { mimetype: "text/html" }, bad);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(bad.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(bad.mock.calls[0][0].code).toBe("UNSUPPORTED_IMAGE_TYPE");
  });
});
