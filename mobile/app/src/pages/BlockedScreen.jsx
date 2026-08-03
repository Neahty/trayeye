import { Ic } from "../components/icons";

// Экран для заблокированного пользователя. Показывается вместо всего приложения,
// когда сервер отвечает 403 { error: "blocked" } — на входе или на любом запросе.
// Формулировка про страну, а не про блокировку: так решено продуктово, тот же текст
// шлют основной бот и бот поддержки (см. server/src/services/moderation.js).
// Кнопок нет намеренно — жаловаться и перепроверять тут нечего.
export default function BlockedScreen() {
  return (
    <div
      className="screen fade-in"
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minHeight: "80vh", textAlign: "center", gap: 18, padding: "0 8px"
      }}
    >
      <div style={{
        width: 88, height: 88, borderRadius: "50%", background: "var(--grad)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 14px 32px -10px var(--primary)"
      }}>
        <Ic name="globe" size={42} sw={1.7} style={{ color: "#fff" }} />
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
        Bytwise не доступен в вашей стране
      </h1>
      <p style={{ fontSize: 16, lineHeight: 1.55, color: "var(--text-2)", margin: 0, maxWidth: 320 }}>
        К сожалению, приложение сейчас недоступно в вашем регионе.
      </p>
    </div>
  );
}
