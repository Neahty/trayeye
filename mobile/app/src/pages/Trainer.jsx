import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { shareLink as shareNative } from "../lib/native";
import { Trainer } from "../api";
import { useApp } from "../AppContext";
import { useUI } from "../ui/UIProvider";
import { Ic, MEAL_LABELS } from "../components/icons";
import PhotoSlot from "../components/PhotoSlot";
import { groupScans, groupTitle } from "../ui/meal";
import { openMealGroup, mealTime } from "../ui/mealDetail";
import { BarChart } from "./Stats";

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function shiftDate(str, delta) {
  const d = new Date(str + "T12:00:00");
  d.setDate(d.getDate() + delta);
  return localDateStr(d);
}
function prettyDate(str) {
  try { return new Date(str + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); }
  catch { return str; }
}

// Маленький график веса (SVG-линия).
function WeightChart({ points, target }) {
  if (!points || points.length < 2) {
    return <div className="muted" style={{ fontSize: 14 }}>Недостаточно данных о весе для графика.</div>;
  }
  const W = 300, H = 90, pad = 6;
  const vals = points.map((p) => Number(p.weight));
  let min = Math.min(...vals, target || Infinity);
  let max = Math.max(...vals, target || -Infinity);
  if (min === max) { min -= 1; max += 1; }
  const x = (i) => pad + (i * (W - 2 * pad)) / (points.length - 1);
  const y = (v) => pad + (1 - (v - min) / (max - min)) * (H - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(Number(p.weight)).toFixed(1)}`).join(" ");
  const targetY = target ? y(target) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 90 }}>
      {targetY != null && <line x1={pad} y1={targetY} x2={W - pad} y2={targetY} stroke="var(--primary-soft)" strokeWidth="1.5" strokeDasharray="4 4" />}
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(Number(p.weight))} r="2.6" fill="var(--primary)" />)}
    </svg>
  );
}

// Карточка приёма клиента у тренера - единый стиль с Историей.
// Одно фото = одна карточка; блюда списком; 💬 если есть комментарии.
function ClientMealCard({ group, onClick }) {
  const multi = group.dishes.length > 1;
  const hasComment = group.dishes.some((d) => d.trainer_comment);
  return (
    <button className="card card-press" onClick={onClick}
      style={{ width: "100%", textAlign: "left", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 14 }}>
        <PhotoSlot meal={{ ...group, dish_name: groupTitle(group) }} width={72} height={72} radius={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16.5, lineHeight: 1.25 }}>{multi ? MEAL_LABELS[group.meal_type] : group.dishes[0].dish_name}</div>
              <div style={{ color: "var(--text-2)", fontSize: 13.5, marginTop: 3 }}>
                {mealTime(group)}{multi ? ` · ${group.dishes.length} блюд` : ` · ${MEAL_LABELS[group.meal_type]}`}
                {hasComment && <span style={{ color: "var(--primary)" }}> · 💬</span>}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 4, flex: "0 0 auto" }}>
              <span style={{ color: "var(--primary)", fontWeight: 800, fontSize: 16.5 }}>{group.calories}</span>
              <span style={{ color: "var(--primary)", fontWeight: 600, fontSize: 13.5 }}>ккал</span>
              <Ic name="chevronRight" size={18} sw={2.2} style={{ color: "var(--text-3)", marginTop: 1 }} />
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, paddingLeft: 2 }}>
        {[["Б", group.protein, "var(--green)"], ["Ж", group.fat, "var(--amber)"], ["У", group.carbs, "var(--blue)"]].map(([l, v, c]) => (
          <div key={l} style={{ fontSize: 13.5, color: "var(--text-2)", fontWeight: 600 }}>
            <span style={{ color: c, fontWeight: 700 }}>{l}</span> {Math.round(Number(v) || 0)} г
          </div>
        ))}
      </div>
    </button>
  );
}

function ClientDetail({ client, onBack, onRemoved }) {
  const ui = useUI();
  const [date, setDate] = useState(localDateStr());
  const [day, setDay] = useState(null);
  const [goals, setGoals] = useState({ daily_calories: "", daily_protein: "", daily_fat: "", daily_carbs: "" });
  const [period, setPeriod] = useState("week");
  const [stats, setStats] = useState(null);
  const [weight, setWeight] = useState(null);

  const loadDay = (d) => Trainer.clientHistory(client.id, d).then((res) => {
    setDay(res);
    const g = res.goals || {};
    setGoals({
      daily_calories: g.daily_calories ?? "",
      daily_protein: g.daily_protein ?? "",
      daily_fat: g.daily_fat ?? "",
      daily_carbs: g.daily_carbs ?? ""
    });
  });

  useEffect(() => { loadDay(date); /* eslint-disable-next-line */ }, [date]);
  useEffect(() => { Trainer.clientStats(client.id, period).then(setStats).catch(() => {}); }, [client.id, period]);
  useEffect(() => { Trainer.clientWeight(client.id).then(setWeight).catch(() => {}); }, [client.id]);

  const saveGoals = async () => {
    try {
      await Trainer.setGoals(client.id, {
        daily_calories: Number(goals.daily_calories) || null,
        daily_protein: Number(goals.daily_protein) || null,
        daily_fat: Number(goals.daily_fat) || null,
        daily_carbs: Number(goals.daily_carbs) || null
      });
      ui.toast("Цели сохранены", "check");
    } catch { ui.toast("Не удалось сохранить цели"); }
  };

  const removeClient = () => ui.sheet({
    type: "info", title: "Убрать клиента?", body: `${client.name || client.username || "Клиент"} перестанет быть вашим клиентом и снова сможет сам менять свои цели КБЖУ.`,
    actionLabel: "Убрать", onAction: async () => {
      try { await Trainer.removeClient(client.id); ui.toast("Клиент удалён", "check"); onRemoved(); }
      catch { ui.toast("Не удалось удалить"); }
    }, secondaryLabel: "Отмена"
  });

  const goalField = (k, label) => (
    <div style={{ flex: 1, minWidth: 70 }}>
      <label style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 600, marginLeft: 4 }}>{label}</label>
      <input className="sheet-input" type="number" inputMode="numeric" value={goals[k]} placeholder="-"
        onChange={(e) => setGoals((g) => ({ ...g, [k]: e.target.value }))} style={{ marginTop: 6 }} />
    </div>
  );

  const t = day?.total || { calories: 0, protein: 0, fat: 0, carbs: 0 };
  const g = day?.goals || {};

  return (
    <div className="screen fade-in">
      <button className="tap" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)", marginBottom: 8, fontWeight: 600 }}>
        <Ic name="chevronRight" size={18} sw={2.2} style={{ transform: "rotate(180deg)" }} /> К списку клиентов
      </button>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <h1 className="h-title" style={{ fontSize: 22 }}>{client.name || client.username || `Клиент #${client.id}`}</h1>
        <button className="tap" onClick={removeClient} style={{ color: "var(--red)", fontWeight: 600, fontSize: 14 }}>Убрать</button>
      </div>

      {/* Цели КБЖУ */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 12, fontSize: 16.5 }}>Цели КБЖУ</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {goalField("daily_calories", "Ккал")}
          {goalField("daily_protein", "Белки, г")}
          {goalField("daily_fat", "Жиры, г")}
          {goalField("daily_carbs", "Углеводы, г")}
        </div>
        <button className="sheet-btn" style={{ marginTop: 12 }} onClick={saveGoals}>Сохранить цели</button>
      </div>

      {/* Дневник за дату */}
      <div style={{ marginTop: 14 }}>
        {/* Навигация по дате */}
        <div className="card" style={{ padding: "10px 14px" }}>
          <div className="row-between">
            <button className="tap icon-btn" onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="Назад"><Ic name="chevronRight" size={20} sw={2.2} style={{ transform: "rotate(180deg)" }} /></button>
            <div style={{ fontWeight: 800, fontSize: 16.5 }}>{prettyDate(date)}</div>
            <button className="tap icon-btn" onClick={() => setDate((d) => shiftDate(d, 1))} disabled={date >= localDateStr()} aria-label="Вперёд"><Ic name="chevronRight" size={20} sw={2.2} /></button>
          </div>
        </div>

        {/* Итого за день */}
        <div className="card" style={{ padding: "14px 16px", background: "var(--tint)", display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
          <span style={{ fontSize: 24 }}>🔥</span>
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ fontSize: 13.5, color: "var(--text-2)", fontWeight: 600 }}>Итого за день</div>
            <div style={{ fontSize: 21, fontWeight: 800, color: "var(--primary)" }}>
              {t.calories}{g.daily_calories ? <span style={{ color: "var(--text-2)", fontSize: 15, fontWeight: 700 }}> / {g.daily_calories}</span> : ""} ккал
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: 14 }}>
            {[["Б", t.protein, "var(--green)"], ["Ж", t.fat, "var(--amber)"], ["У", t.carbs, "var(--blue)"]].map(([l, v, c]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 12.5, color: c, fontWeight: 700 }}>{l}</div>
                <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 2 }}>{Math.round(Number(v) || 0)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Приёмы */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          {day?.scans?.length
            ? groupScans(day.scans)
                .sort((a, b) => new Date(a.scanned_at) - new Date(b.scanned_at))
                .map((gr) => (
                  <ClientMealCard key={gr.key} group={gr}
                    onClick={() => openMealGroup(ui, gr, () => loadDay(date), null, { trainer: true })} />
                ))
            : <div className="card muted" style={{ padding: 18, textAlign: "center" }}>Нет записей за этот день</div>}
        </div>
      </div>

      {/* Статистика */}
      <div className="card" style={{ padding: 16, marginTop: 14 }}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 800 }}>Калории за период</div>
          <div className="seg" style={{ width: "auto" }}>
            {["week", "month"].map((p) => (
              <button key={p} className={"seg-btn" + (period === p ? " active" : "")} onClick={() => setPeriod(p)}>{p === "week" ? "Неделя" : "Месяц"}</button>
            ))}
          </div>
        </div>
        {stats?.chart?.some((c) => c.calories > 0)
          ? <BarChart chart={stats.chart} metric="calories" goal={stats.daily_norm || 0} granularity={stats.granularity || "day"} onBar={() => {}} />
          : <div className="muted" style={{ padding: "10px 0", textAlign: "center" }}>Нет данных за период</div>}
      </div>

      {/* Вес */}
      <div className="card" style={{ padding: 16, marginTop: 14, marginBottom: 8 }}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 800 }}>Вес</div>
          <div className="muted" style={{ fontSize: 13.5 }}>
            {weight?.weight_history?.length ? `${Number(weight.weight_history[weight.weight_history.length - 1].weight)} кг` : "-"}
            {weight?.target_weight ? ` · цель ${Number(weight.target_weight)} кг` : ""}
          </div>
        </div>
        <WeightChart points={weight?.weight_history} target={weight?.target_weight ? Number(weight.target_weight) : null} />
      </div>
    </div>
  );
}

export default function TrainerPage() {
  const { profile } = useApp();
  const ui = useUI();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [clients, setClients] = useState([]);
  const [selected, setSelected] = useState(null);

  const isTrainer = profile?.is_trainer;

  const load = () => Trainer.clients().then((d) => setClients(d.clients)).catch(() => {});
  useEffect(() => { if (isTrainer) { load(); Trainer.invite().then(setInvite).catch(() => {}); } }, [isTrainer]);

  // Отвязать клиента прямо из списка (с подтверждением).
  const confirmRemove = (c) => ui.sheet({
    type: "info", title: "Убрать клиента?",
    body: `${c.name || c.username || "Клиент"} перестанет быть вашим клиентом и снова сможет сам менять свои цели КБЖУ.`,
    actionLabel: "Убрать",
    onAction: async () => {
      try { await Trainer.removeClient(c.id); ui.toast("Клиент удалён", "check"); load(); }
      catch { ui.toast("Не удалось удалить"); }
    },
    secondaryLabel: "Отмена"
  });

  if (!isTrainer) {
    return (
      <div className="screen fade-in">
        <h1 className="h-title" style={{ marginBottom: 12 }}>Кабинет тренера</h1>
        <div className="card" style={{ padding: 18, textAlign: "center" }}>
          <p className="muted" style={{ marginBottom: 14 }}>Чтобы вести клиентов, нужна тренерская подписка.</p>
          <button className="sheet-btn" onClick={() => navigate("/become-trainer")}>Стать тренером</button>
        </div>
      </div>
    );
  }

  if (selected) {
    return <ClientDetail client={selected} onBack={() => { setSelected(null); load(); }} onRemoved={() => { setSelected(null); load(); }} />;
  }

  const copyLink = async () => {
    if (!invite?.link) return;
    try { await navigator.clipboard.writeText(invite.link); ui.toast("Ссылка скопирована", "check"); }
    catch { ui.toast(invite.link); }
  };
  // Системное «Поделиться» iOS, с откатом на копирование в буфер.
  const share = async () => {
    if (!invite?.link) return;
    const ok = await shareNative(invite.link, invite.share_text || "");
    if (!ok) copyLink();
  };

  return (
    <div className="screen fade-in">
      <button className="tap" onClick={() => navigate("/profile")} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)", marginBottom: 8, fontWeight: 600 }}>
        <Ic name="chevronRight" size={18} sw={2.2} style={{ transform: "rotate(180deg)" }} /> Профиль
      </button>
      <h1 className="h-title" style={{ marginBottom: 14 }}>Кабинет тренера</h1>

      {/* Приглашение */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Пригласить клиента</div>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 12 }}>Отправьте клиенту ссылку - по ней он подключится к вам.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sheet-btn" style={{ flex: 1 }} onClick={share}>Поделиться</button>
          <button className="sheet-btn ghost" onClick={copyLink} style={{ flex: "0 0 auto", width: "auto", marginTop: 0, paddingInline: 22 }}>Копировать</button>
        </div>
      </div>

      {/* Клиенты */}
      <h3 className="sec-title" style={{ margin: "20px 4px 10px", fontSize: 18, fontWeight: 800 }}>Клиенты ({clients.length})</h3>
      {clients.length === 0 && <div className="card muted" style={{ padding: 16, textAlign: "center" }}>Пока нет клиентов. Поделитесь ссылкой выше.</div>}
      {clients.map((c) => (
        <div key={c.id} className="card" style={{ padding: 0, marginBottom: 10, display: "flex", alignItems: "stretch", overflow: "hidden" }}>
          <button className="tap" onClick={() => setSelected(c)}
            style={{ flex: 1, minWidth: 0, textAlign: "left", padding: 16, background: "none" }}>
            <div className="row-between">
              <strong style={{ fontSize: 16 }}>{c.name || c.username || `#${c.id}`}</strong>
              <span style={{ color: "var(--primary)", fontWeight: 800, fontSize: 15.5 }}>{c.today_calories} ккал</span>
            </div>
            <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>
              Б {Math.round(c.today_protein)} · Ж {Math.round(c.today_fat)} · У {Math.round(c.today_carbs)} · норма {c.daily_calories || "-"}
            </div>
          </button>
          <button className="tap" onClick={() => confirmRemove(c)} aria-label="Удалить клиента"
            style={{ flex: "0 0 auto", padding: "0 16px", color: "var(--red)", display: "flex", alignItems: "center", justifyContent: "center", background: "none", borderLeft: "1px solid var(--border)" }}>
            <Ic name="trash" size={20} sw={2} />
          </button>
        </div>
      ))}
    </div>
  );
}
