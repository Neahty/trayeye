// Уменьшает фото перед загрузкой: ресайз до maxSize по большей стороне + JPEG.
// Это убирает гигантские (до 10 МБ) паялоады, из-за которых загрузка скана
// зависала/обрывалась на мобильной сети. При любой ошибке возвращаем исходный файл.
export async function downscaleImage(file, maxSize = 1536, quality = 0.82) {
  try {
    if (!file || !file.type?.startsWith("image/")) return file;
    // imageOrientation: "from-image" — применяем EXIF-поворот при декодировании, иначе
    // вертикальные фото с телефона уходили на сервер повёрнутыми на 90° и AI видел еду боком.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    // Уже маленькое — не трогаем
    if (scale >= 1 && file.size < 1.5 * 1024 * 1024) {
      bitmap.close?.();
      return file;
    }
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob) return file;
    return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
