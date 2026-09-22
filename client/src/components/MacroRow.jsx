const COLORS = { protein: "var(--protein)", fat: "var(--fat)", carbs: "var(--carbs)" };
const LABELS = { protein: "Белки", fat: "Жиры", carbs: "Углеводы" };

export default function MacroRow({ type, value = 0, goal = 0, unit = "г" }) {
  const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
  return (
    <div className="macro-row">
      <div className="macro-head">
        <span>{LABELS[type]}</span>
        <span>
          {Math.round(value)} / {goal || "-"} {unit}
        </span>
      </div>
      <div className="macro-track">
        <div className="macro-fill" style={{ width: `${pct}%`, background: COLORS[type] }} />
      </div>
    </div>
  );
}
