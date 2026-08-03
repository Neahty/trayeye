import { useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Ic } from "./icons";
import { useUI } from "../ui/UIProvider";
import { isNative, pickPhoto, tapFeedback } from "../lib/native";

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

  // В приложении снимок делает системная камера iOS, в браузере (npm run dev) —
  // обычный file input. Дальше по коду разницы нет: и там, и там получается File.
  const grabPhoto = async (fromCamera) => {
    if (!isNative()) {
      (fromCamera ? cameraRef : galleryRef).current?.click();
      return;
    }
    try {
      const file = await pickPhoto(fromCamera);
      if (file && onCapture) onCapture(file);
    } catch (e) {
      // Отказ в доступе лечится только в настройках телефона — говорим об этом прямо,
      // иначе «не удалось» выглядит как поломка приложения.
      const msg = String(e?.message || "").toLowerCase();
      if (/denied|permission|not allowed|unauthorized/.test(msg)) {
        ui.toast(fromCamera
          ? "Разрешите доступ к камере в Настройках → Bytwise"
          : "Разрешите доступ к фото в Настройках → Bytwise");
      } else {
        ui.toast("Не удалось получить фото");
      }
    }
  };

  const pickSource = () => ui.sheet({
    type: "info",
    title: "Добавить фото",
    sub: "💡 Если еда в упаковке — сфоткайте сторону с составом и КБЖУ: так AI посчитает точнее",
    actionLabel: "Сделать фото",
    actionIcon: "camera",
    onAction: () => grabPhoto(true),
    secondaryLabel: "Выбрать из галереи",
    onSecondary: () => grabPhoto(false)
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
      <button className="fab" disabled={busy} onClick={() => { tapFeedback(); pickSource(); }} aria-label="Сфотографировать еду">
        <Ic name="camera" size={28} sw={1.9} />
      </button>
    </div>
  );
}
