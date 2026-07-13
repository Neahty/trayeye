import { Admin } from "../api";
import { useFetch, Loader, Stat } from "../lib.jsx";

// Эмодзи по шагу воронки (ключи приходят с сервера).
const STEP_EMOJI = {
  started: "🚀",
  opened: "📱",
  profile: "📝",
  first_scan: "📸",
  returned: "🔁",
  bought: "👑"
};

// Цвет пилюли «дошло X%» (доля от предыдущего шага): много — зелёный, мало — красный.
function retClass(pct) {
  if (pct >= 70) return "green";
  if (pct >= 40) return "amber";
  return "red";
}

export default function Funnel() {
  const { data, loading } = useFetch(Admin.funnel, []);
  if (loading) return <Loader />;

  const steps = data.funnel || [];
  const start = steps[0]?.value || 0;
  const max = start || 1;
  const last = steps[steps.length - 1] || {};

  // Самый большой отвал между шагами (где теряем больше всего людей).
  let worst = null;
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].drop && (!worst || steps[i].drop > worst.drop)) {
      worst = { drop: steps[i].drop, label: steps[i].label };
    }
  }

  return (
    <div>
      <div className="topbar"><h1 className="page-title">Путь клиента</h1></div>
      <div className="muted" style={{ marginTop: -6, marginBottom: 18, fontSize: 13 }}>
        Сколько людей доходит до каждого шага: от запуска до оплаты. У каждого шага — доля от старта,
        сколько дошло с прошлого шага и сколько ушло.
      </div>

      {/* сводка */}
      <div className="grid cols-3" style={{ marginBottom: 20 }}>
        <Stat label="Пришло всего" value={start} sub="нажали /start" />
        <Stat label="Конверсия в оплату" value={`${last.conversion || 0}%`} sub={`${last.value || 0} оплат`} />
        <Stat
          label="Главный отвал"
          value={worst ? `−${worst.drop}` : "—"}
          sub={worst ? `на шаге «${worst.label}»` : "потерь нет"}
        />
      </div>

      {/* воронка */}
      <div className="card">
        <div className="funnel">
          {steps.map((s, i) => {
            const prev = i === 0 ? s.value : steps[i - 1].value;
            const retention = i === 0 ? 100 : prev ? Math.round((s.value / prev) * 100) : 0;
            const widthPct = Math.max(20, (s.value / max) * 100);
            const isLast = i === steps.length - 1;
            return (
              <div key={s.key} style={{ width: "100%" }}>
                {/* коннектор-отвал между шагами */}
                {i > 0 && (
                  <div className="funnel-conn">
                    <span className="fn-arrow">▼</span>
                    {s.drop > 0 && <span className="fn-lost">−{s.drop} ушло</span>}
                  </div>
                )}

                <div className="funnel-step">
                  <div className="funnel-label">{s.label}</div>
                  <div className={"funnel-bar" + (isLast ? " gold" : "")} style={{ width: widthPct + "%" }}>
                    <span className="fn-emoji">{STEP_EMOJI[s.key] || "•"}</span>
                    <span className="fn-value">{s.value}</span>
                  </div>
                  <div className="funnel-meta">
                    <span className="fn-pct">{s.conversion}%</span>
                    <span>от старта</span>
                    {i > 0 && <span className={"fn-pill " + retClass(retention)}>дошло {retention}%</span>}
                    {i > 0 && s.drop > 0 && <span className="fn-pill red">−{s.drop}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
