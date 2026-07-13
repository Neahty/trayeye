import { useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Ic } from "./icons";
import { useUI } from "../ui/UIProvider";

const NAV = [
  { id: "/", label: "Главная", icon: "home" },
  { id: "/history", label: "История", icon: "clock" },
  { id: "/stats", label: "Статистика", icon: "bars" },
  { id: "/profile", label: "Профиль", icon: "user" }
];

export default function TabBar({ onCapture, busy }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const ui = useUI();
  const cameraRef = useRef();
  const galleryRef = useRef();

  const pickSource = () => ui.sheet({
    type: "info",
    title: "Добавить фото",
    sub: "💡 Если еда в упаковке — сфоткайте сторону с составом и КБЖУ: так AI посчитает точнее",
    actionLabel: "Сделать фото",
    actionIcon: "camera",
    onAction: () => cameraRef.current?.click(),
    secondaryLabel: "Выбрать из галереи",
    onSecondary: () => galleryRef.current?.click()
  });

  const Tab = (n) => {
    const active = pathname === n.id;
    return (
      <button key={n.id} className={"tab" + (active ? " active" : "")} onClick={() => navigate(n.id)}>
        <Ic name={n.icon} size={25} sw={active ? 2.2 : 1.8} />
        <span>{n.label}</span>
      </button>
    );
  };

  const left = NAV.slice(0, 2);
  const right = NAV.slice(2);

  return (
    <div className="tabbar">
      {left.map(Tab)}
      <div style={{ flex: 1 }} />
      {right.map(Tab)}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && onCapture) onCapture(f);
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && onCapture) onCapture(f);
        }}
      />
      <button className="fab" disabled={busy} onClick={pickSource} aria-label="Сфотографировать еду">
        <Ic name="camera" size={28} sw={1.9} />
      </button>
    </div>
  );
}
