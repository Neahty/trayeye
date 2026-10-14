import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useSession } from "../session.jsx";
import { appUrl } from "../lib/api";
import { Icon } from "./ui.jsx";

const NAV = {
  director: [
    { to: "/director", label: "Главная", icon: "home", end: true },
    { to: "/director/classes", label: "Классы", icon: "users" },
    { to: "/director/stats", label: "Статистика", icon: "stats" },
    { to: "/director/menu", label: "Меню", icon: "book" },
    { to: "/director/settings", label: "Настройки", icon: "settings" }
  ],
  kombinat: [
    { to: "/kombinat", label: "Главная", icon: "home", end: true },
    { to: "/kombinat/schools", label: "Школы", icon: "users" },
    { to: "/kombinat/stats", label: "Статистика", icon: "stats" },
    { to: "/kombinat/suppliers", label: "Поставщики", icon: "book" },
    { to: "/kombinat/settings", label: "Настройки", icon: "settings" }
  ]
};

const COLLAPSED_KEY = "trayeye_sidebar_collapsed";

export default function Layout({ children }) {
  const { cabinet, logout } = useSession();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const title = cabinet.role === "director" ? cabinet.schoolName : cabinet.kombinatName;

  const onLogout = () => { logout(); navigate("/"); };
  const toggleSidebar = () => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    setCollapsed(!collapsed);
  };

  return (
    <div className={`layout role-${cabinet.role}${collapsed ? " collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="avatar">
          {cabinet.avatarUrl ? <img src={appUrl(cabinet.avatarUrl)} alt="" /> : <span className="brand-mark">tray<br />eye</span>}
        </div>
        <nav aria-label="Основная навигация">
          {NAV[cabinet.role].map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} title={item.label}>
              <Icon name={item.icon} size={18} /><span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="logout-link" onClick={onLogout}><Icon name="logout" size={16} /><span className="nav-label">Выйти</span></button>
        <button
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
          aria-expanded={!collapsed}
        >
          <img src={appUrl("/figma/imgArrowRightCircle.svg")} alt="" />
        </button>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{title}</div>
          <div className="topbar-actions" aria-label="Действия">
            <span className="round-action search-action" title="Поиск" aria-hidden="true"><Icon name="search" size={17} /></span>
            <img className="round-action" src={appUrl("/figma/imgNotificationBellPending.svg")} title="Уведомления" alt="" />
            <div className="profile-pill">
              <img src={appUrl(cabinet.avatarUrl || "/figma/imgRectangle4271.png")} alt="" />
              <Icon name="arrowDown" size={16} />
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
