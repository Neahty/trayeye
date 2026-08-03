// Открытие внешних ссылок из приложения.
// В отличие от мини-аппа в Telegram, здесь нет ни openTelegramLink, ни openLink:
// ссылку отдаём системе, и iOS сам решает, чем её открыть — t.me уйдёт в Telegram,
// если он установлен, остальное в Safari.
export function openTgLink(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener");
}
