import { NavLink } from "react-router-dom";

export default function NavBar({ isAdmin, isTrainer }) {
  const items = [
    { to: "/", icon: "🏠", label: "Главная" },
    { to: "/history", icon: "📅", label: "История" },
    { to: "/stats", icon: "📊", label: "Статистика" },
    { to: "/profile", icon: "👤", label: "Профиль" }
  ];
  if (isTrainer) items.push({ to: "/trainer", icon: "🏋️", label: "Клиенты" });
  if (isAdmin) items.push({ to: "/admin", icon: "🛡️", label: "Админ" });

  return (
    <nav className="navbar">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
          <span className="icon">{i.icon}</span>
          <span>{i.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
