// Тонкая обёртка над нативными возможностями iOS.
//
// Приложение должно запускаться и в браузере (npm run dev — так удобнее отлаживать
// экраны с Windows), поэтому каждый вызов молча превращается в пустышку, если мы
// не внутри нативной сборки.
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { Share } from "@capacitor/share";

export const isNative = () => Capacitor.isNativePlatform();

// Снимок приходит строкой base64, а вся остальная логика (сжатие, отправка)
// работает с File — собираем File сами.
function base64ToFile(b64, format) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = format || "jpg";
  return new File([bytes], `meal.${ext}`, { type: ext === "png" ? "image/png" : "image/jpeg" });
}

// Снимок или выбор из галереи системным интерфейсом.
// Возвращает File, либо null — если человек передумал.
export async function pickPhoto(fromCamera) {
  try {
    const photo = await Camera.getPhoto({
      source: fromCamera ? CameraSource.Camera : CameraSource.Photos,
      // Именно Base64, а не Uri: интерфейс загружен с https://shekspireteam.ru,
      // а плагин отдал бы ссылку capacitor://localhost/... — забрать по ней файл
      // со страницы другой схемы браузерный движок не даёт. Base64 приходит
      // через мост Capacitor, минуя сеть.
      resultType: CameraResultType.Base64,
      // Ужимаем сразу в плагине: полный кадр это ~8 МБ, а в base64 он раздувается
      // ещё на треть. Дальше downscaleImage всё равно приводит к 1536 px.
      width: 1600,
      quality: 85,
      // Кадрировать не даём: AI считает калории по всей тарелке, обрезка только вредит.
      allowEditing: false,
      correctOrientation: true,
      presentationStyle: "fullscreen"
    });
    if (!photo?.base64String) throw new Error("empty_photo");
    return base64ToFile(photo.base64String, photo.format);
  } catch (e) {
    // Отмена — не ошибка. Плагин сообщает о ней текстом, кода у неё нет.
    const msg = String(e?.message || "").toLowerCase();
    if (msg.includes("cancel")) return null;
    throw e;
  }
}

// Системное «Поделиться» iOS: список приложений, куда можно кинуть ссылку.
// Возвращает false, если поделиться не вышло — тогда вызывающий код копирует
// ссылку в буфер, чтобы кнопка не выглядела сломанной.
export async function shareLink(url, text) {
  if (!isNative()) return false;
  try {
    await Share.share({ title: "Bytwise", text: text || "", url, dialogTitle: "Поделиться ссылкой" });
    return true;
  } catch {
    return false;
  }
}

export async function tapFeedback() {
  if (!isNative()) return;
  try { await Haptics.impact({ style: ImpactStyle.Medium }); } catch { /* не критично */ }
}

// Заставка держится до явной команды (launchAutoHide: false в capacitor.config.json),
// чтобы не мигать белым экраном, пока грузится профиль.
export async function hideSplash() {
  if (!isNative()) return;
  try { await SplashScreen.hide(); } catch { /* не критично */ }
}

// Цвет иконок статус-бара под тему приложения: на светлой теме — тёмные, наоборот — светлые.
export async function syncStatusBar(theme) {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light });
  } catch { /* не критично */ }
}
