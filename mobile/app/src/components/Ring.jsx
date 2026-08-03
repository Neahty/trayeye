export function Ring({ size = 132, stroke = 13, percent = 0, gradId = "rg", children, track = "var(--track)" }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  const off = circ * (1 - pct / 100);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--primary-soft)" />
            <stop offset="100%" stopColor="var(--primary)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${gradId})`}
          strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off}
          style={{ transition: "stroke-dashoffset .9s cubic-bezier(.4,0,.2,1)" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}

export function Donut({ size = 96, stroke = 17, segments = [] }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
      {segments.map((s, i) => {
        const len = circ * (s.value / 100);
        const el = (
          <circle
            key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
            strokeWidth={stroke} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc}
            style={{ transition: "stroke-dasharray .8s ease" }}
          />
        );
        acc += len;
        return el;
      })}
    </svg>
  );
}
