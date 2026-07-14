import { useState, useMemo } from "react";
import { Profile } from "../api";
import { Ic } from "../components/icons";
import { TIMEZONES, tzLabel, detectTz } from "../lib/timezones";
import Stepper from "../components/NumberPicker";

export default function Onboarding({ user, onDone }) {
  const detectedTz = useMemo(() => detectTz(), []);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState({
    name: user?.name || "",
    age: user?.age || 25,
    gender: user?.gender || "",
    height: user?.height || 175,
    weight: user?.weight ? Math.round(Number(user.weight)) : 70,
    target_weight: user?.target_weight ? Math.round(Number(user.target_weight)) : (user?.weight ? Math.round(Number(user.weight)) : 70),
    workouts_per_week: user?.workouts_per_week ?? 3,
    pace: user?.pace || "mid",
    timezone: user?.timezone || detectedTz
  });
  const set = (patch) => setD((p) => ({ ...p, ...patch }));

  const steps = [
    {
      title: "Как вас зовут?", sub: "Чтобы обращаться к вам по имени",
      valid: () => d.name.trim().length >= 1,
      body: () => (
        <input className="sheet-input" autoFocus placeholder="Ваше имя" value={d.name}
          onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && next()} />
      )
    },
    {
      title: "Сколько вам лет?", sub: "Возраст влияет на дневную норму",
      valid: () => d.age >= 10 && d.age <= 99,
      body: () => <Stepper value={d.age} min={10} max={99} unit="лет" onChange={(v) => set({ age: v })} />
    },
    {
      title: "Ваш пол", sub: "Нужно для точного расчёта КБЖУ",
      valid: () => !!d.gender,
      body: () => (
        <div style={{ display: "flex", gap: 12 }}>
          {[["male", "Мужской", "♂"], ["female", "Женский", "♀"]].map(([v, label, sym]) => (
            <button key={v} className="tap" onClick={() => set({ gender: v })}
              style={{ flex: 1, padding: "22px 0", borderRadius: 18, fontWeight: 800, fontSize: 17,
                border: "2px solid " + (d.gender === v ? "var(--primary)" : "var(--border-2)"),
                background: d.gender === v ? "var(--tint)" : "var(--surface-2)", color: d.gender === v ? "var(--primary)" : "var(--text)" }}>
              <div style={{ fontSize: 30, marginBottom: 6 }}>{sym}</div>{label}
            </button>
          ))}
        </div>
      )
    },
    {
      title: "Рост и вес", sub: "Для расчёта нормы калорий",
      valid: () => d.height >= 120 && d.weight >= 35,
      body: () => (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div><div style={{ textAlign: "center", color: "var(--text-2)", fontWeight: 600, marginBottom: 6 }}>Рост, см</div>
            <Stepper value={d.height} min={120} max={220} unit="см" onChange={(v) => set({ height: v })} /></div>
          <div><div style={{ textAlign: "center", color: "var(--text-2)", fontWeight: 600, marginBottom: 6 }}>Вес, кг</div>
            <Stepper value={d.weight} min={35} max={200} unit="кг" onChange={(v) => set({ weight: v })} /></div>
        </div>
      )
    },
    {
      title: "Желаемый вес", sub: "К какому весу стремитесь",
      valid: () => d.target_weight >= 35,
      body: () => <Stepper value={d.target_weight} min={35} max={200} unit="кг" onChange={(v) => set({ target_weight: v })} />
    },
    {
      title: "Темп достижения цели", sub: "Влияет на дефицит/профицит калорий",
      valid: () => !!d.pace,
      body: () => {
        const delta = Math.round((d.weight - d.target_weight) * 10) / 10;
        const dir = delta > 0 ? `похудеть на ${delta} кг` : delta < 0 ? `набрать ${-delta} кг` : null;
        const PACES = [
          { key: "fast", title: "Быстрый темп", sub: "Заметный дефицит калорий" },
          { key: "mid", title: "Оптимально", sub: "Сбалансированно", badge: "рекомендуем" },
          { key: "slow", title: "Спокойный темп", sub: "Мягкий дефицит" }
        ];
        return (
          <div>
            <p className="muted" style={{ textAlign: "center", fontSize: 13.5, margin: "0 6px 14px", lineHeight: 1.45 }}>
              {dir ? `Чтобы ${dir}, выберите комфортный темп — Bytwise подстроит норму калорий.` : "Выберите желаемый темп — при поддержании веса он не меняет норму."}
            </p>
            {PACES.map((p) => (
              <button key={p.key} className="tap" onClick={() => set({ pace: p.key })}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "15px 16px", borderRadius: 16, marginBottom: 10, textAlign: "left",
                  background: d.pace === p.key ? "var(--tint)" : "var(--surface-2)",
                  border: "2px solid " + (d.pace === p.key ? "var(--primary)" : "transparent"), color: "var(--text)" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontSize: 16.5 }}>{p.title}</span>
                    {p.badge && <span className="pill-pro">{p.badge}</span>}
                  </span>
                  <span style={{ display: "block", color: "var(--text-2)", fontSize: 13.5, marginTop: 3 }}>{p.sub}</span>
                </span>
                {d.pace === p.key && <Ic name="check" size={22} sw={2.6} style={{ color: "var(--primary)", flex: "0 0 auto" }} />}
              </button>
            ))}
          </div>
        );
      }
    },
    {
      title: "Как часто ходите в зал?", sub: "Тренировок в неделю",
      valid: () => d.workouts_per_week >= 0,
      body: () => <Stepper value={d.workouts_per_week} min={0} max={14} unit="трен/нед" onChange={(v) => set({ workouts_per_week: v })} />
    },
    {
      title: "Часовой пояс", sub: "Чтобы дни и напоминания совпадали",
      valid: () => !!d.timezone,
      body: () => (
        <select className="sheet-input" value={d.timezone} onChange={(e) => set({ timezone: e.target.value })}>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tzLabel(tz)}</option>
          ))}
        </select>
      )
    }
  ];

  const cur = steps[step];
  const isLast = step === steps.length - 1;

  const next = async () => {
    if (!cur.valid()) return;
    if (!isLast) { setStep((s) => s + 1); return; }
    setBusy(true);
    try {
      await Profile.update({
        name: d.name.trim(), age: d.age, gender: d.gender, height: d.height, weight: d.weight,
        target_weight: d.target_weight, workouts_per_week: d.workouts_per_week, pace: d.pace,
        timezone: d.timezone, onboarded: true
      });
      await onDone();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="screen" style={{ paddingBottom: 40, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0 26px" }}>
        {step > 0 && (
          <button className="icon-btn tap" onClick={() => setStep((s) => s - 1)} aria-label="Назад">
            <Ic name="chevronRight" size={20} sw={2.2} style={{ transform: "rotate(180deg)" }} />
          </button>
        )}
        <div style={{ flex: 1, height: 6, borderRadius: 4, background: "var(--track)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: ((step + 1) / steps.length) * 100 + "%", background: "var(--grad)", borderRadius: 4, transition: "width .3s" }} />
        </div>
        <span style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 700 }}>{step + 1}/{steps.length}</span>
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
          <span style={{ fontSize: 24, fontWeight: 800 }}>Bytwise</span>
          <span className="pill-pro">SETUP</span>
        </div>
        <h1 className="h-title" style={{ fontSize: 27, marginTop: 14 }}>{cur.title}</h1>
        <p className="muted" style={{ fontSize: 15.5, margin: "8px 0 26px" }}>{cur.sub}</p>
        <div className="pop-in" key={step}>{cur.body()}</div>
      </div>

      <button className="sheet-btn" disabled={busy || !cur.valid()} onClick={next} style={{ marginTop: 24 }}>
        {busy ? "Сохраняем…" : isLast ? "Начать пользоваться" : "Далее"}
        {!busy && <Ic name="chevronRight" size={20} sw={2.4} />}
      </button>
    </div>
  );
}
