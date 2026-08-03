import { useRef } from "react";
import { useUI } from "../ui/UIProvider";

export default function CameraButton({ onPick, disabled, label = "📷 Сфотографировать еду" }) {
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

  const onChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onPick(file);
  };

  return (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onChange} />
      <input ref={galleryRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onChange} />
      <button className="btn" disabled={disabled} onClick={pickSource}>
        {label}
      </button>
    </>
  );
}
