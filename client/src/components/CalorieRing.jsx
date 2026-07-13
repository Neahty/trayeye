export default function CalorieRing({ consumed = 0, goal = 0 }) {
  const size = 160;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(consumed / goal, 1) : 0;
  const offset = c * (1 - pct);
  const left = goal > 0 ? Math.max(goal - consumed, 0) : 0;

  return (
    <div className="ring-wrap">
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#EDE9FE" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--primary)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="46%" textAnchor="middle" className="ring-value" fill="var(--primary)" fontSize="30" fontWeight="800">
          {consumed}
        </text>
        <text x="50%" y="60%" textAnchor="middle" fill="var(--text-secondary)" fontSize="12">
          из {goal || "—"} ккал
        </text>
      </svg>
      <div className="ring-sub">{goal > 0 ? `Осталось ${left} ккал` : "Заполни профиль для расчёта нормы"}</div>
    </div>
  );
}
