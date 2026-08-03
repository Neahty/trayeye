import { assetUrl } from "../api";
import { MealIcon } from "./icons";

// Красивый плейсхолдер вместо «пустоты», если фото нет.
// meal — объект скана (photo_path, meal_type, source). radius/size настраиваются.
export default function PhotoSlot({ meal, size, width, height, radius = 14, shape = "rounded" }) {
  const w = width ?? size ?? 58;
  const h = height ?? size ?? 58;
  const br = shape === "circle" ? "50%" : `${radius}px`;
  const style = { width: w, height: h, borderRadius: br, flex: `0 0 ${typeof w === "number" ? w + "px" : w}` };

  const src = assetUrl(meal?.photo_path);

  if (src) {
    return (
      <div className="photo-slot" style={style}>
        <img src={src} alt={meal?.dish_name || ""} loading="lazy" />
      </div>
    );
  }

  // нет фото (текст/ручной ввод) — показываем иконку приёма пищи на тинте
  return (
    <div className="photo-slot" style={style}>
      <span className="ph-emoji">
        <MealIcon kind={meal?.meal_type || "snack"} size={Math.min(34, (typeof h === "number" ? h : 58) * 0.5)} />
      </span>
    </div>
  );
}
