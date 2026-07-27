import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Auth, setToken } from "../api";
import { useAuth } from "../App.jsx";
import { useLive } from "../lib.jsx";

// Индикатор автообновления: зелёная точка = живёт, серая = на паузе. Клик — пауза/возобновить.
function LiveIndicator() {
  const { paused, refreshSec, togglePaused } = useLive();
  if (!refreshSec) return null; // автообновление выключено в настройках
  return (
    <button className="btn ghost sm" onClick={togglePaused}
      style={{ width: "100%", marginBottom: 8, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: paused ? "var(--text-3)" : "var(--green)" }} />
      {paused ? "Автообновление на паузе" : `Live · каждые ${refreshSec}с`}
    </button>
  );
}

const NAV = [
  { to: "/", label: "Главная", end: true },
  { to: "/users", label: "Пользователи" },
  { to: "/employees", label: "Работники" },
  { to: "/invites", label: "Приглашения" },
  { to: "/subscriptions", label: "Подписки" },
  { to: "/finance", label: "Деньги" },
  { to: "/ai", label: "Расходы на ИИ" },
  { to: "/scans", label: "Распознавание еды" },
  { to: "/notifications", label: "Рассылки" },
  { to: "/support", label: "Поддержка" },
  { to: "/quests", label: "Квесты" },
  { to: "/links", label: "Ссылки" },
  { to: "/funnel", label: "Путь клиента" },
  { to: "/logs", label: "История действий" },
  { to: "/settings", label: "Настройки" }
];

export default function Layout({ children }) {
  const { admin, setAdmin } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const logout = async () => {
    try { await Auth.logout(); } catch { /* ignore */ }
    setToken(null);
    setAdmin(null);
    navigate("/login");
  };

  const close = () => setOpen(false);

  return (
    <div className="shell">
      {/* Мобильная шапка: видна только на телефонах (CSS). Кнопка ☰ открывает меню. */}
      <header className="mobile-topbar">
        <button className="burger" onClick={() => setOpen(true)} aria-label="Меню">☰</button>
        <div className="brand"><span className="logo">B</span> Bytwise</div>
      </header>

      {/* Затемнение под выехавшим меню */}
      {open && <div className="drawer-overlay" onClick={close} />}

      <aside className={"sidebar" + (open ? " open" : "")}>
        <div className="brand">
          <span className="logo">B</span> Bytwise
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} onClick={close}
            className={({ isActive }) => "navlink" + (isActive ? " active" : "")}>
            {n.label}
          </NavLink>
        ))}
        <div style={{ marginTop: 24, padding: "0 8px" }}>
          <LiveIndicator />
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{admin?.name || admin?.username}</div>
          <button className="btn ghost sm" onClick={logout} style={{ width: "100%" }}>Выйти</button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
