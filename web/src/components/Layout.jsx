import { NavLink, useNavigate } from "react-router-dom";
import { useSession } from "../session.jsx";
import { appUrl } from "../lib/api";

const NAV = {
  director: [
    { to: "/director", label: "Главная", icon: "⌂", end: true },
    { to: "/director/classes", label: "Классы", icon: "♟" },
    { to: "/director/stats", label: "Статистика", icon: "◩" },
    { to: "/director/menu", label: "Меню", icon: "◧" },
    { to: "/director/settings", label: "Настройки", icon: "⚙" }
  ],
  kombinat: [
    { to: "/kombinat", label: "Главная", icon: "⌂", end: true },
    { to: "/kombinat/schools", label: "Школы", icon: "♟" },
    { to: "/kombinat/stats", label: "Статистика", icon: "◩" },
    { to: "/kombinat/suppliers", label: "Поставщики", icon: "▣" },
    { to: "/kombinat/settings", label: "Настройки", icon: "⚙" }
  ]
};

export default function Layout({ children }) {
  const { cabinet, logout } = useSession();
  const navigate = useNavigate();
  const title = cabinet.role === "director" ? cabinet.schoolName : cabinet.kombinatName;

  const onLogout = () => { logout(); navigate("/"); };

  return (
    <div className={`layout role-${cabinet.role}`}>
      <aside className="sidebar">
        <div className="avatar">
          {cabinet.avatarUrl ? <img src={appUrl(cabinet.avatarUrl)} alt="" /> : <span className="brand-mark">tray<br />eye</span>}
        </div>
        <nav aria-label="Основная навигация">
          {NAV[cabinet.role].map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="logout-link" onClick={onLogout}><span aria-hidden="true">↪</span> Выйти</button>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{title}</div>
          <div className="topbar-actions" aria-label="Действия">
            <span className="round-action" title="Поиск" aria-hidden="true">⌕</span>
            <span className="round-action" title="Уведомления" aria-hidden="true">♧</span>
            <div className="profile-pill">
              <img src={appUrl(cabinet.avatarUrl || "/figma/imgRectangle4271.png")} alt="" />
              <span>⌄</span>
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
