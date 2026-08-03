import { Ic } from "./icons";

export default function EmptyState({ icon = "utensils", title, sub, action, onAction, actionIcon = "plus" }) {
  return (
    <div className="empty-state fade-in">
      <div className="es-icon">
        <Ic name={icon} size={32} sw={1.7} />
      </div>
      {title && <div className="es-title">{title}</div>}
      {sub && <div className="es-sub">{sub}</div>}
      {action && (
        <button className="sheet-btn tap" style={{ height: 50, marginTop: 6, width: "auto", padding: "0 22px" }} onClick={onAction}>
          <Ic name={actionIcon} size={19} sw={2.2} />
          {action}
        </button>
      )}
    </div>
  );
}
