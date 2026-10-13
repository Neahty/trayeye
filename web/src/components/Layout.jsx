import { NavLink, useNavigate } from "react-router-dom";
import { useSession } from "../session.jsx";

// Пункты меню - как в макете Figma.
const NAV = {
  director: [
    { to: "/director", label: "Главная", end: true },
    { to: "/director/classes", label: "Классы" },
    { to: "/director/stats", label: "Статистика" },
    { to: "/director/menu", label: "Меню" },
    { to: "/director/settings", label: "Настройки" }
  ],
  kombinat: [
    { to: "/kombinat", label: "Главная", end: true },
    { to: "/kombinat/schools", label: "Школы" },
    { to: "/kombinat/stats", label: "Статистика" },
    { to: "/kombinat/suppliers", label: "Поставщики" },
    { to: "/kombinat/settings", label: "Настройки" }
  ]
};

export default function Layout({ children }) {
  const { cabinet, logout } = useSession();
  const navigate = useNavigate();
  const title = cabinet.role === "director" ? cabinet.schoolName : cabinet.kombinatName;

  const onLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="avatar">
          {cabinet.avatarUrl ? <img src={cabinet.avatarUrl} alt="" /> : <span>аватар</span>}
        </div>
        <nav>
          {NAV[cabinet.role].map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>
          ))}
        </nav>
        <button className="link" onClick={onLogout}>Выйти</button>
      </aside>
      <div className="main">
        <header className="topbar"><strong>{title}</strong></header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
