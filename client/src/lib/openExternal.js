// Открытие внешней ссылки из Telegram-webview.
// В мини-аппе `window.location.href = <чужой домен>` молча игнорируется webview -
// экран просто ничего не делает (так ломалась оплата ЮKassa). Нужен openLink.
export function openExternal(url) {
  if (!url) return false;
  const tg = window.Telegram?.WebApp;
  try {
    if (tg?.openTelegramLink && /(^|\/\/)(t\.me|telegram\.me)\//.test(url)) {
      tg.openTelegramLink(url);
      return true;
    }
    if (tg?.openLink) {
      tg.openLink(url);
      return true;
    }
  } catch {
    // ниже - обычные браузерные способы
  }
  const w = window.open(url, "_blank", "noopener");
  if (w) return true;
  // Попап заблокирован (не мини-апп, обычный браузер) - уходим в том же окне.
  window.location.href = url;
  return true;
}

// Открытие окна оплаты ЮKassa.
// Внутри webview мини-аппа страница оплаты открывается, но диплинки в приложения банков
// (tinkoff://, bank1000...://) webview не обрабатывает - «не переходит в приложение банка».
// Поэтому уводим оплату в системный браузер, оттуда банк подхватывается штатно.
// Плюс шторка с кнопкой: openLink Telegram разрешает только «в ответ на действие
// пользователя», а мы зовём его после ответа сервера - если автозапуск не сработал,
// пользователь жмёт кнопку сам, и это уже прямой жест.
export function openPayment(ui, url) {
  if (!url) return;
  openExternal(url);
  ui.sheet({
    type: "info",
    title: "Оплата открыта в браузере",
    body: "Завершите оплату и вернитесь сюда - подписка активируется автоматически. Если браузер не открылся, нажмите кнопку ниже.",
    actionLabel: "Открыть оплату",
    onAction: () => openExternal(url)
  });
}

export default openExternal;
