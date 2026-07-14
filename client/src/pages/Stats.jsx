import { useEffect, useState } from "react";
import { Stats, Quests } from "../api";
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
  const [qData, setQData] = useState(null);

  useEffect(() => {
    // Игнорируем ответ устаревшего запроса: при быстром переключении табов
    // День/Неделя/Месяц поздний ответ старого таба перетирал данные нового.
    let alive = true;
    Stats.get(tab).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [tab, dataVersion]);
  const loadQuests = () => Quests.get().then(setQData).catch(() => setQData({ quests: [] }));
  useEffect(() => {
    loadQuests();
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

  // Забрать награду: сервер проверяет выполнение и шлёт ссылку в ЛС. При недоступном боте — тост.
  const claimReward = async (q, close) => {
    try {
      await Quests.claim(q.code);
      if (close) close();
      ui.toast("Награда отправлена в личные сообщения бота 🎁", "check");
      loadQuests();
    } catch (e) {
      const code = e?.response?.data?.error;
      const msg =
        code === "dm_unavailable" ? "Откройте бота и нажмите «Start», чтобы получить награду" :
        code === "already_claimed" ? "Награда уже получена" :
        code === "not_completed" ? "Квест ещё не выполнен" :
        "Не удалось получить награду. Попробуйте позже";
      ui.toast(msg);
    }
  };

  // Подписи/цвета статуса квеста.
  const questStatus = (q) => q.claimed ? "Получено" : q.complete ? "Доступно к получению" : "В процессе";
  const questBtnLabel = (q) => q.claimed ? "Награда получена" : q.complete ? "Забрать награду" : "В процессе";

  const questDetail = (q) => ui.sheet({
    type: "custom", render: (close) => {
      const ready = q.complete && !q.claimed;
      return (
        <div>
          <div className="grip" />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, padding: "6px 0 22px" }}>
            <div style={{ width: 86, height: 86, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 42, background: q.complete ? "var(--grad)" : "var(--surface-2)", boxShadow: q.complete ? "0 12px 28px -8px var(--primary)" : "none", opacity: q.complete ? 1 : 0.6 }}>
              {q.emoji || "🎯"}
            </div>
            <h3 className="sheet-h">{q.title}</h3>
            <span style={{ fontSize: 13, fontWeight: 700, color: q.claimed ? "var(--green-ink)" : q.complete ? "var(--primary)" : "var(--text-3)", background: q.claimed ? "color-mix(in srgb, var(--green) 16%, transparent)" : q.complete ? "var(--tint-2)" : "var(--surface-2)", padding: "4px 12px", borderRadius: 9 }}>
              {questStatus(q)}
            </span>
            {q.reward_title && (
              <div style={{ fontSize: 15, color: "var(--text-2)" }}>Награда: <span style={{ color: "var(--text)", fontWeight: 700 }}>{q.reward_title}</span></div>
            )}
            {q.description && <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--text-2)", margin: 0 }}>{q.description}</p>}
            <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
              <div style={{ flex: 1, height: 9, borderRadius: 5, background: "var(--track)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: q.pct + "%", background: "var(--grad)", borderRadius: 5 }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)", whiteSpace: "nowrap" }}>{q.claimed ? "Получено" : `${q.current}/${q.goal}`}</span>
            </div>
          </div>
          <button className="sheet-btn" disabled={!ready} style={{ opacity: ready ? 1 : 0.55 }}
            onClick={() => { if (ready) claimReward(q, close); }}>
            {questBtnLabel(q)}
          </button>
          <button className="tap" onClick={close} style={{ width: "100%", height: 52, borderRadius: 16, marginTop: 10, fontWeight: 800, fontSize: 16, border: "1.5px solid var(--border-2)", background: "var(--surface-2)", color: "var(--text)" }}>Закрыть</button>
        </div>
      );
    }
  });

  const allQuests = () => {
    const list = qData?.quests || [];
    ui.sheet({
      type: "custom", render: (close) => (
        <div>
          <div className="grip" />
          <div className="row-between" style={{ marginBottom: 6 }}>
            <h3 className="sheet-h" style={{ margin: 0 }}>Квесты с наградами</h3>
            <span className="pill-pro">{list.filter((q) => q.claimed).length}/{list.length}</span>
          </div>
          <p style={{ color: "var(--text-2)", fontSize: 15, margin: "0 0 18px" }}>Выполняйте задания и забирайте бонусы от Bytwise</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {list.map((q) => {
              const ready = q.complete && !q.claimed;
              return (
                <div key={q.code} style={{ border: "1.5px solid " + (ready ? "var(--primary)" : "var(--border)"), background: ready ? "var(--tint)" : "var(--surface-2)", borderRadius: 18, padding: "15px 16px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
                    <span style={{ width: 44, height: 44, borderRadius: 13, flex: "0 0 44px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, background: q.complete ? "var(--grad)" : "var(--surface)", opacity: q.complete ? 1 : 0.55 }}>{q.emoji || "🎯"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15.5, lineHeight: 1.3 }}>{q.title}</div>
                      {q.reward_title && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, color: "var(--text-2)", fontSize: 13 }}>
                          🎁 <span style={{ color: "var(--text)", fontWeight: 600 }}>{q.reward_title}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 13 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 5, background: "var(--track)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: q.pct + "%", background: "var(--grad)", borderRadius: 5 }} />
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)", whiteSpace: "nowrap" }}>{q.claimed ? "Получено" : `${q.current}/${q.goal}`}</span>
                  </div>
                  <button className="tap" disabled={!ready}
                    onClick={() => { if (ready) claimReward(q, close); }}
                    style={{ width: "100%", height: 44, borderRadius: 13, marginTop: 12, fontWeight: 800, fontSize: 14.5, border: "none", fontFamily: "inherit", background: ready ? "var(--grad)" : "var(--surface)", color: ready ? "#fff" : "var(--text-2)", opacity: ready ? 1 : 0.6 }}>
                    {questBtnLabel(q)}
                  </button>
                </div>
              );
            })}
            {!list.length && <div style={{ textAlign: "center", color: "var(--text-2)", padding: "20px 0" }}>Квестов пока нет — заглядывайте позже.</div>}
          </div>
        </div>
      )
    });
  };

  const qList = qData?.quests || [];
  const questsDone = qList.filter((q) => q.claimed).length;
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

      {/* квесты с наградами (заменяют достижения) */}
      {qList.length > 0 && (
        <div className="card" style={{ padding: 18, marginTop: 14 }}>
          <div className="row-between" style={{ marginBottom: 16 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontSize: 18, fontWeight: 800 }}>Квесты с наградами</span>
              <span className="pill-pro">{questsDone}/{qList.length}</span>
            </span>
            <button className="tap" onClick={allQuests} style={{ color: "var(--primary)", fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", gap: 3 }}>
              Все <Ic name="chevronRight" size={16} sw={2.2} />
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {qList.slice(0, 5).map((q) => (
              <button key={q.code} className="tap" onClick={() => questDetail(q)}
                style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", background: "none" }}>
                <span style={{ position: "relative", width: 54, height: 54, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, background: q.complete ? "var(--grad)" : "var(--surface-2)", opacity: q.complete ? 1 : 0.55, boxShadow: (q.complete && !q.claimed) ? "0 10px 22px -8px var(--primary)" : "none" }}>
                  {q.emoji || "🎯"}
                  {q.claimed && (
                    <span style={{ position: "absolute", right: -2, bottom: -2, width: 20, height: 20, borderRadius: "50%", background: "var(--green)", border: "2px solid var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                      <Ic name="check" size={12} sw={3.2} />
                    </span>
                  )}
                </span>
                <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.15 }}>{q.title}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-3)", lineHeight: 1.15, fontWeight: 600 }}>{q.claimed ? "Получено" : `${q.current}/${q.goal}`}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
