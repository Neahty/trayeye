import { useEffect, useState } from "react";
import { Stats, Achievements } from "../api";
import { useApp } from "../AppContext";
import { useUI } from "../ui/UIProvider";
import { Ic } from "../components/icons";
import { Donut } from "../components/Ring";
import EmptyState from "../components/EmptyState";
import { useCountUp } from "../lib/useCountUp";

const TABS = [
  { id: "day", label: "День" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
  { id: "year", label: "Год" }
];
const METRICS = [
  { id: "calories", label: "По калориям", title: "Калории", unit: "ккал" },
  { id: "protein", label: "По белкам", title: "Белки", unit: "г" },
  { id: "carbs", label: "По углеводам", title: "Углеводы", unit: "г" },
  { id: "fat", label: "По жирам", title: "Жиры", unit: "г" }
];
const CHART_H = 200;

function fmtDay(d) {
  const dt = new Date(d);
  return dt.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
function fmtMonth(d) {
  return new Date(d).toLocaleDateString("ru-RU", { month: "short" });
}
function dow(d) {
  return ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][new Date(d).getDay()];
}

// Округление верхней границы оси до «красивого» числа (для БЖУ значения мелкие, не 500)
function niceMax(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * pow;
}

export function BarChart({ chart, metric, goal, granularity, onBar }) {
  const vals = chart.map((b) => Number(b[metric]) || 0);
  const maxData = Math.max(1, ...vals, goal || 0);
  // Калории масштабируем шагами по 500, макросы — динамически, иначе столбцы почти не видны
  const max = metric === "calories" ? (Math.ceil(maxData / 500) * 500 || 500) : niceMax(maxData);
  const goalY = goal ? CHART_H * (1 - goal / max) : null;
  // При большом числе столбцов (год — 12 месяцев) сужаем, чтобы помещалось на мобильном
  const bw = chart.length > 8 ? 16 : 26;
  // Подпись бакета под столбцом зависит от гранулярности:
  // день — «Пн / 5 июн»; неделя — «5 июн» (начало недели); месяц — «июн».
  const topLabel = (d) => granularity === "month" ? fmtMonth(d) : granularity === "week" ? fmtDay(d) : dow(d);
  const subLabel = (d) => granularity === "day" ? fmtDay(d) : "";
  const ticks = 5;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => Math.round((max / ticks) * (ticks - i)));

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: CHART_H, fontSize: 12, color: "var(--text-3)", fontWeight: 600, textAlign: "right", width: 38, paddingTop: 1 }}>
        {tickVals.map((t) => <div key={t}>{t}</div>)}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ position: "relative", height: CHART_H }}>
          {tickVals.map((t, i) => (
            <div key={t} style={{ position: "absolute", left: 0, right: 0, top: (CHART_H * i) / ticks, borderTop: "1px solid var(--border)" }} />
          ))}
          {goalY != null && (
            <>
              <div style={{ position: "absolute", left: 0, right: 0, top: goalY, borderTop: "2px dashed var(--primary-soft)" }} />
              <div style={{ position: "absolute", right: 0, top: goalY - 19, fontSize: 12.5, color: "var(--primary)", fontWeight: 700 }}>Цель: {Math.round(goal)}</div>
            </>
          )}
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "space-around", padding: "0 2px" }}>
            {chart.map((b, i) => {
              const v = Number(b[metric]) || 0;
              return (
                <button key={b.day} onClick={() => onBar(b)}
                  style={{ width: bw, display: "flex", flexDirection: "column", background: "none", justifyContent: "flex-end", height: "100%", cursor: "pointer" }}>
                  <div className="bar-grow" style={{ height: CHART_H * (v / max), background: "var(--grad)", borderRadius: "7px 7px 0 0", transformOrigin: "bottom", animationDelay: i * 0.05 + "s" }} />
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-around", marginTop: 8 }}>
          {chart.map((b) => (
            <div key={b.day} style={{ width: bw, textAlign: "center" }}>
              <div style={{ fontSize: bw < 20 ? 11 : 12.5, fontWeight: 700 }}>{topLabel(b.day)}</div>
              {subLabel(b.day) && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{subLabel(b.day)}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MacroBar({ color, label, grams, pct }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span className="dot" style={{ background: color }} />
        <span style={{ fontSize: 14.5, color: "var(--text-2)", fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, margin: "6px 0 2px" }}>{grams} г</div>
      <div style={{ fontSize: 13.5, color: "var(--text-3)", fontWeight: 600, marginBottom: 8 }}>{pct}%</div>
      <div style={{ height: 6, borderRadius: 4, background: "var(--track)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: pct + "%", background: color, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function MiniStat({ icon, color, value, unit, label, isEmoji, onClick }) {
  return (
    <button className="card card-press" onClick={onClick}
      style={{ flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 7, textAlign: "center", width: "100%" }}>
      {isEmoji ? <span style={{ fontSize: 26 }}>{icon}</span> : <Ic name={icon} size={27} sw={1.9} style={{ color }} />}
      <div>
        <span style={{ fontSize: 19, fontWeight: 800 }}>{value}</span>
        {unit && <span style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 600 }}> {unit}</span>}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 600, lineHeight: 1.2 }}>{label}</div>
    </button>
  );
}

export default function StatsPage() {
  const { dataVersion } = useApp();
  const ui = useUI();
  const [tab, setTab] = useState("week");
  const [metric, setMetric] = useState("calories");
  const [data, setData] = useState(null);
  const [ach, setAch] = useState(null);

  useEffect(() => {
    // Игнорируем ответ устаревшего запроса: при быстром переключении табов
    // День/Неделя/Месяц поздний ответ старого таба перетирал данные нового.
    let alive = true;
    Stats.get(tab).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [tab, dataVersion]);
  useEffect(() => {
    Achievements.get().then(setAch).catch(() => setAch({ achievements: [] }));
  }, [dataVersion]);

  const total = useCountUp(data?.totals?.[metric] || 0, 1000, [data?.totals?.[metric], tab, metric]);

  const chart = data?.chart || [];
  const granularity = data?.granularity || "day";
  const goal = data?.daily_norm || 0;
  // Цели по выбранной метрике (для линии «Цель» на графике)
  const goals = {
    calories: data?.daily_norm || 0,
    protein: data?.goal_protein || 0,
    fat: data?.goal_fat || 0,
    carbs: data?.goal_carbs || 0
  };
  const avg = data?.averages?.calories || 0;
  const totals = data?.totals || { protein: 0, fat: 0, carbs: 0 };
  const pSum = totals.protein * 4, fSum = totals.fat * 9, cSum = totals.carbs * 4;
  const macroSum = pSum + fSum + cSum;
  const hasMacro = macroSum > 0;
  const macroTotal = macroSum || 1;
  const pPct = hasMacro ? Math.round((pSum / macroTotal) * 100) : 0;
  const fPct = hasMacro ? Math.round((fSum / macroTotal) * 100) : 0;
  const cPct = hasMacro ? Math.max(0, 100 - pPct - fPct) : 0;

  const metricMeta = METRICS.find((m) => m.id === metric) || METRICS[0];
  const metricLabel = metricMeta.label;
  const metricAvg = data?.averages?.[metric] || 0;

  const pickMetric = () => ui.sheet({
    type: "options", title: "Показатель графика", value: metric,
    options: METRICS.map((m) => ({ value: m.id, label: m.label, icon: "bars" })),
    onPick: (v) => setMetric(v)
  });
  const barInfo = (b) => ui.sheet({
    type: "info", title: fmtDay(b.day),
    body: `Калории: ${b.calories} ккал · Б ${Math.round(b.protein)} / Ж ${Math.round(b.fat)} / У ${Math.round(b.carbs)} г.` + (goal ? ` Цель ${goal} ккал.` : ""),
    actionLabel: "Понятно"
  });
  const statInfo = (title, body) => () => ui.sheet({ type: "info", title, body, actionLabel: "Понятно" });

  const achDetail = (a) => ui.sheet({
    type: "custom", render: (close) => (
      <div>
        <div className="grip" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, padding: "6px 0 22px" }}>
          <div style={{ width: 86, height: 86, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: a.done ? "var(--grad)" : "var(--surface-2)", boxShadow: a.done ? "0 12px 28px -8px var(--primary)" : "none", opacity: a.done ? 1 : 0.6 }}>
            {a.emoji ? <span style={{ fontSize: 42, filter: a.done ? "none" : "grayscale(1)" }}>{a.emoji}</span>
              : <Ic name={a.icon} size={42} sw={1.7} style={{ color: a.done ? "#fff" : "var(--text-3)" }} />}
          </div>
          <h3 className="sheet-h">{a.title}</h3>
          <span style={{ fontSize: 13, fontWeight: 700, color: a.done ? "var(--green-ink)" : "var(--text-3)", background: a.done ? "color-mix(in srgb, var(--green) 16%, transparent)" : "var(--surface-2)", padding: "4px 12px", borderRadius: 9 }}>
            {a.done ? "Получено" : "Не получено"}
          </span>
          <p style={{ fontSize: 15.5, lineHeight: 1.5, color: "var(--text-2)", margin: 0 }}>{a.description}</p>
        </div>
        <button className="sheet-btn" onClick={close}>Закрыть</button>
      </div>
    )
  });

  const allAch = () => {
    const list = ach?.achievements || [];
    const cats = [];
    const byCat = {};
    for (const a of list) {
      const c = a.category || "Достижения";
      if (!byCat[c]) { byCat[c] = []; cats.push(c); }
      byCat[c].push(a);
    }
    const doneCount = list.filter((a) => a.done).length;
    ui.sheet({
      type: "custom", render: (close) => (
        <div>
          <div className="grip" />
          <div className="row-between" style={{ marginBottom: 16 }}>
            <h3 className="sheet-h" style={{ margin: 0 }}>Все достижения</h3>
            <span className="pill-pro">{doneCount}/{list.length}</span>
          </div>
          {cats.map((c) => (
            <div key={c} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".4px", margin: "0 4px 8px" }}>{c}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {byCat[c].map((a) => (
                  <button key={a.code} className="opt" style={{ marginBottom: 0, opacity: a.done ? 1 : 0.7 }} onClick={() => { close(); setTimeout(() => achDetail(a), 300); }}>
                    <span className="opt-ic" style={{ background: a.done ? "var(--tint)" : "var(--surface)" }}>
                      {a.emoji ? <span style={{ fontSize: 20, filter: a.done ? "none" : "grayscale(1)" }}>{a.emoji}</span> : <Ic name={a.icon} size={21} sw={1.9} />}
                    </span>
                    <span style={{ flex: 1, textAlign: "left" }}>
                      <div>{a.title}</div>
                      <div style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 600, marginTop: 2 }}>{a.subtitle}</div>
                    </span>
                    {a.done && <span className="check"><Ic name="check" size={20} sw={2.6} /></span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    });
  };

  const achList = ach?.achievements || [];
  const hasData = chart.some((c) => c.calories > 0);

  return (
    <div className="screen fade-in">
      <div className="row-between" style={{ padding: "6px 0 16px" }}>
        <h1 className="h-title">Статистика</h1>
      </div>

      <div className="seg">
        {TABS.map((t) => (
          <button key={t.id} className={"seg-btn" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* calories card */}
      <div className="card" style={{ padding: 18, marginTop: 16 }}>
        <div className="row-between" style={{ alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{metricMeta.title}</div>
            <div style={{ marginTop: 4 }}>
              <span style={{ fontSize: 26, fontWeight: 800 }}>{total.toLocaleString("ru-RU")}</span>
              <span style={{ fontSize: 15, color: "var(--text-2)", fontWeight: 600 }}> {metricMeta.unit}</span>
            </div>
            <div style={{ fontSize: 14, color: "var(--text-2)", marginTop: 2 }}>
              В среднем <span style={{ color: "var(--primary)", fontWeight: 700 }}>{metricAvg}</span> {metricMeta.unit} в день
            </div>
          </div>
          <button className="chip tap" style={{ padding: "8px 11px", fontSize: 14 }} onClick={pickMetric}>
            {metricLabel} <Ic name="chevronDown" size={16} sw={2.2} style={{ color: "var(--text-3)" }} />
          </button>
        </div>
        {hasData ? (
          <BarChart chart={chart} metric={metric} goal={goals[metric]} granularity={granularity} onBar={barInfo} />
        ) : (
          <EmptyState icon="bars" title="Нет данных за период" sub="Добавляйте приёмы пищи — здесь появится график калорий и БЖУ." />
        )}
      </div>

      {/* БЖУ */}
      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>БЖУ за период</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", flex: 1, gap: 10 }}>
            <MacroBar color="var(--green)" label="Белки" grams={Math.round(totals.protein)} pct={pPct} />
            <MacroBar color="var(--amber)" label="Жиры" grams={Math.round(totals.fat)} pct={fPct} />
            <MacroBar color="var(--blue)" label="Углеводы" grams={Math.round(totals.carbs)} pct={cPct} />
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <Donut size={96} stroke={17} segments={[
              { value: pPct, color: "var(--green)" },
              { value: fPct, color: "var(--amber)" },
              { value: cPct, color: "var(--blue)" }
            ]} />
          </div>
        </div>
      </div>

      {/* mini stats */}
      <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
        <MiniStat icon="🔥" isEmoji value={avg} unit="ккал" label="В среднем в день"
          onClick={statInfo("Средние калории", `В среднем вы потребляете ${avg} ккал в день` + (goal ? ` при норме ${goal} ккал.` : "."))} />
        <MiniStat icon="utensils" color="var(--primary)" value={data?.meals_per_day || 0} label="Приёмов пищи в день"
          onClick={statInfo("Приёмы пищи", `В среднем ${data?.meals_per_day || 0} приёмов пищи в день за выбранный период.`)} />
        <MiniStat icon="camera" color="var(--green)" value={data?.photos_count || 0} label="Фото за период"
          onClick={statInfo("Фото блюд", `За период вы добавили ${data?.photos_count || 0} блюд с помощью камеры.`)} />
      </div>

      {/* achievements */}
      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        <div className="row-between" style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 800 }}>Достижения</span>
          <button className="tap" onClick={allAch} style={{ color: "var(--primary)", fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", gap: 3 }}>
            Все <Ic name="chevronRight" size={16} sw={2.2} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {achList.slice(0, 5).map((a) => (
            <button key={a.code} className="tap" onClick={() => achDetail(a)}
              style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", background: "none" }}>
              <div style={{ width: 54, height: 54, borderRadius: "50%", background: a.done ? "var(--surface-2)" : "var(--surface)", opacity: a.done ? 1 : 0.45, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {a.emoji ? <span style={{ fontSize: 26, filter: a.done ? "none" : "grayscale(1)" }}>{a.emoji}</span> : <Ic name={a.icon} size={26} sw={1.9} style={{ color: a.color }} />}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.15 }}>{a.title}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-3)", lineHeight: 1.15 }}>{a.subtitle}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
