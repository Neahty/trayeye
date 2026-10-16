import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useSession } from "../session.jsx";
import { appUrl } from "../lib/api";
import { useFocusFlash } from "../lib/hooks";
import { motionTokens, springs } from "../lib/motion";
import { Icon } from "./ui.jsx";
import Topbar from "./Topbar.jsx";

export const NAV = {
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

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}

// Смена страницы: новая сразу на месте и плавно выезжает снизу. Без ожидания ухода старой
// (mode="wait"): отзывчивость важнее плавности, и переход не зависнет, если кадры не рисуются.
const pageMotion = {
  initial: { opacity: 0, y: motionTokens.distance.sm },
  animate: { opacity: 1, y: 0 },
  transition: { duration: motionTokens.duration.normal, ease: motionTokens.easing.smooth }
};

// Каркас кабинета: меню слева, шапка, страница из вложенного маршрута.
export default function Layout() {
  const { cabinet, logout } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const title = cabinet.role === "director" ? cabinet.schoolName : cabinet.kombinatName;
  const nav = NAV[cabinet.role];
  useFocusFlash();

  const onLogout = () => { logout(); navigate("/"); };
  const toggleSidebar = () => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1"); } catch { /* приватный режим */ }
    setCollapsed(!collapsed);
  };

  return (
    <div className={`layout role-${cabinet.role}${collapsed ? " collapsed" : ""}`}>
      <aside className="sidebar">
        <div className={cabinet.avatarUrl ? "avatar" : "avatar brand"}>
          {cabinet.avatarUrl ? <img src={appUrl(cabinet.avatarUrl)} alt="" /> : <>
            {/* Логотип от дизайнера; в свёрнутом меню остаётся только знак без надписи. */}
            <img className="brand-logo" src={appUrl("/brand/trayeye-logo-wide.png")} alt="TrayEye" />
            <img className="brand-icon" src={appUrl("/brand/trayeye-mark.png")} alt="TrayEye" />
          </>}
        </div>
        <nav aria-label="Основная навигация">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} title={item.label}>
              {({ isActive }) => <>
                {isActive && <motion.span layoutId="nav-active" className="nav-active" transition={springs.snappy} />}
                <Icon name={item.icon} size={18} /><span className="nav-label">{item.label}</span>
              </>}
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
        <Topbar cabinet={cabinet} title={title} nav={nav} />
        <motion.main key={pathname} className="content" {...pageMotion}>
          <Outlet />
        </motion.main>
      </div>
    </div>
  );
}
