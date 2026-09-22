import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { History, Stats, Settings } from "../api";
import { useApp } from "../AppContext";
import { useUI } from "../ui/UIProvider";
import { Ic, MealIcon, MEAL_LABELS } from "../components/icons";
import { Ring } from "../components/Ring";
import PhotoSlot from "../components/PhotoSlot";
import EmptyState from "../components/EmptyState";
import { useCountUp } from "../lib/useCountUp";
import { openTgLink } from "../lib/tg";
import { openAddByText } from "../ui/addByText";
import { openMealGroup, mealTime } from "../ui/mealDetail";
import { groupScans, groupTitle } from "../ui/meal";
import { subBadge } from "../lib/sub";

function MealStat({ kind, kcal, onClick }) {
  return (
    <button className="tap" onClick={onClick}
      style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 0, background: "none", padding: "4px 2px", borderRadius: 14 }}>
      <MealIcon kind={kind} size={30} />
      <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 600 }}>{MEAL_LABELS[kind]}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{kcal}</div>
      <div style={{ fontSize: 12, color: "var(--text-2)" }}>ккал</div>
    </button>
  );
}

function HistoryRow({ group, onClick, tz }) {
  const multi = group.dishes.length > 1;
  const title = multi ? `${MEAL_LABELS[group.meal_type]} · ${group.dishes.length} блюд` : group.dishes[0].dish_name;
  return (
    <button className="hist-row" onClick={onClick}>
      <PhotoSlot meal={{ ...group, dish_name: groupTitle(group) }} size={58} radius={14} />
      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <div style={{ fontWeight: 700, fontSize: 16.5, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ color: "var(--text-2)", fontSize: 14, marginTop: 3 }}>{mealTime(group, tz)}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "0 0 auto" }}>
        <span style={{ color: "var(--primary)", fontWeight: 800, fontSize: 17 }}>{group.calories}</span>
        <span style={{ color: "var(--primary)", fontWeight: 600, fontSize: 14 }}>ккал</span>
        <Ic name="chevronRight" size={18} sw={2.2} style={{ color: "var(--text-3)" }} />
      </div>
    </button>
  );
}

export default function Home() {
  const { profile, dataVersion, bumpData } = useApp();
  const navigate = useNavigate();
  const ui = useUI();
  const [today, setToday] = useState(null);
  const [stats, setStats] = useState(null);
  const [links, setLinks] = useState({});

  useEffect(() => {
    Settings.public().then((s) => setLinks(s || {})).catch(() => {});
  }, []);

  // Внешняя ссылка открывается системным браузером: Telegram-обёртки здесь нет.
  const openExternal = (url) => openTgLink(url);

  const user = profile?.user || {};
  const tz = user.timezone || "Europe/Moscow";
  // Сегодняшняя дата в поясе пользователя. Приоритет - server_today (полный ICU на сервере),
  // клиентский Intl ненадёжен в Telegram-webview (отсюда были «6 число вместо 5»).
  const date = profile?.server_today
    || new Date().toLocaleDateString("en-CA", { timeZone: tz });

  async function load() {
    const [t, s] = await Promise.all([History.byDate(date), Stats.get("week")]);
    setToday(t);
    setStats(s);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dataVersion, date]);

  const onChange = () => { bumpData(); };

  const total = today?.total || { calories: 0, protein: 0, fat: 0, carbs: 0 };
  const goal = user.daily_calories || 2000;
  const percent = goal ? Math.min(100, Math.round((total.calories / goal) * 100)) : 0;
  const kcalAnim = useCountUp(total.calories, 900, [total.calories]);

  const meals = today ? [...today.meals.breakfast, ...today.meals.lunch, ...today.meals.dinner, ...today.meals.snack] : [];
  // Одно фото = один приём: группируем и берём 3 последних приёма.
  const recent = groupScans(meals).sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at)).slice(0, 3);
  const breakdown = (k) => (today?.meals[k] || []).reduce((a, m) => a + (m.calories || 0), 0);

  const isPro = profile?.subscription?.status === "active" || profile?.trial?.active;
  const dateLabel = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  const streak = stats?.streak || 0;
  const avgConsumption = stats?.averages?.calories || 0;

  const mealInfo = (kind) => ui.sheet({
    type: "info", title: MEAL_LABELS[kind],
    body: `Всего за приём: ${breakdown(kind)} ккал. Откройте историю, чтобы увидеть блюда этой категории.`,
    actionLabel: "Открыть историю", actionIcon: "clock", onAction: () => navigate("/history")
  });

  return (
    <div className="screen fade-in">
      {/* header */}
      <div className="row-between" style={{ padding: "0 0 18px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-.6px" }}>Bytwise</span>
            {isPro && <span className="pill-pro">{subBadge(profile?.subscription?.type)}</span>}
          </div>
          <div className="muted" style={{ fontSize: 15 }}>
            {user.name ? `Привет, ${user.name}!` : "Считай калории легко с AI"}
          </div>
        </div>
      </div>

      {/* summary card */}
      <button className="card card-press" onClick={() => navigate("/stats")}
        style={{ width: "100%", textAlign: "left", padding: 22, display: "flex", alignItems: "center", gap: 22, background: "var(--tint)" }}>
        <Ring size={128} stroke={13} percent={percent} gradId="home-ring" track="color-mix(in srgb, var(--primary) 16%, var(--surface))">
          <div style={{ fontSize: 30, fontWeight: 800 }}>{percent}%</div>
          <div style={{ fontSize: 14, color: "var(--text-2)", marginTop: -2 }}>от цели</div>
        </Ring>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ color: "var(--text-2)", fontSize: 16, fontWeight: 600 }}>Калории</div>
          <div>
            <span style={{ fontSize: 27, fontWeight: 800, color: "var(--primary)" }}>{kcalAnim}</span>
            <span style={{ fontSize: 16, color: "var(--text-2)", fontWeight: 600 }}> / {goal} ккал</span>
          </div>
          <div style={{ color: "var(--text-2)", fontSize: 15, fontWeight: 600, marginTop: 8 }}>Белки / Жиры / Углеводы</div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>
            <span className="c-green">{Math.round(total.protein)}</span>
            <span style={{ color: "var(--text-3)" }}> / </span>
            <span className="c-amber">{Math.round(total.fat)}</span>
            <span style={{ color: "var(--text-3)" }}> / </span>
            <span className="c-blue">{Math.round(total.carbs)}</span>
            <span style={{ color: "var(--text-2)", fontWeight: 600, fontSize: 15 }}> г</span>
          </div>
          <span style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 5, color: "var(--primary)", fontWeight: 700, fontSize: 16 }}>
            Подробнее <Ic name="chevronRight" size={17} sw={2.4} />
          </span>
        </div>
      </button>

      {/* Сегодня */}
      <div className="row-between" style={{ margin: "26px 0 14px" }}>
        <h2 className="sec-title">Сегодня</h2>
        <span className="chip"><Ic name="calendar" size={18} sw={1.8} /> {dateLabel}</span>
      </div>
      <div className="card" style={{ padding: "18px 14px", display: "flex", gap: 6 }}>
        {["breakfast", "lunch", "dinner", "snack"].map((k) => (
          <MealStat key={k} kind={k} kcal={breakdown(k)} onClick={() => mealInfo(k)} />
        ))}
      </div>

      {/* Задать вопрос нутрициологу (ссылка из админки) */}
      {(
        <button className="card card-press" onClick={() => links.nutritionist_url ? openExternal(links.nutritionist_url) : ui.toast("Ссылка скоро будет добавлена", "info")}
          style={{ width: "100%", marginTop: 12, display: "flex", alignItems: "center", gap: 13, padding: "15px 16px", textAlign: "left" }}>
          <span style={{ width: 44, height: 44, borderRadius: 13, flex: "0 0 44px", background: "var(--tint)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic name="help" size={22} sw={1.8} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 800, fontSize: 16 }}>Задать вопрос нутрициологу</span>
            <span style={{ display: "block", color: "var(--text-2)", fontSize: 13.5, marginTop: 2 }}>Персональный ответ в Telegram</span>
          </span>
          <Ic name="chevronRight" size={18} sw={2.2} style={{ color: "var(--text-3)", flex: "0 0 auto" }} />
        </button>
      )}

      {/* Серия дней */}
      <h2 className="sec-title" style={{ margin: "26px 0 14px" }}>Серия дней</h2>
      <div className="card" style={{ padding: "20px 22px", display: "flex", alignItems: "center", gap: 18, background: "var(--tint)" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", flex: "0 0 64px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--grad)", boxShadow: "0 12px 26px -8px var(--primary)" }}>
          <span className="flame-pulse" style={{ fontSize: 32 }}>🔥</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: "var(--text-2)", fontWeight: 700, letterSpacing: ".3px", textTransform: "uppercase" }}>Текущая серия</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 3 }}>
            <span style={{ fontSize: 30, fontWeight: 800, color: "var(--primary)", lineHeight: 1 }}>{streak}</span>
            <span style={{ fontSize: 17, fontWeight: 700 }}>{streak === 1 ? "день" : "дней подряд"}</span>
          </div>
          <div style={{ fontSize: 14.5, color: "var(--text-2)", marginTop: 7 }}>
            Среднее потребление: <span style={{ fontWeight: 700, color: "var(--text)" }}>{avgConsumption} ккал</span>
          </div>
        </div>
      </div>

      {/* AI добавление текстом (замена избранного) */}
      <h2 className="sec-title" style={{ margin: "26px 0 14px" }}>Добавить блюдо</h2>
      <button className="card card-press ai-card" onClick={() => openAddByText(ui, onChange, tz, (reason) => navigate("/paywall", { state: { reason } }))}>
        <span className="ai-spark"><Ic name="sparkles" size={26} sw={1.9} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>Опишите блюдо текстом</div>
          <div style={{ color: "var(--text-2)", fontSize: 14, marginTop: 3 }}>Без фото - AI сам посчитает калории и БЖУ</div>
        </div>
        <span className="add-btn" style={{ width: 38, height: 38, borderRadius: "50%", flex: "0 0 38px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface)", color: "var(--primary)" }}>
          <Ic name="plus" size={22} sw={2.4} />
        </span>
      </button>

      {/* Авторский план тренировок (промо-ссылка из админки) */}
      {(
        <button className="card card-press" onClick={() => links.plan_url ? openExternal(links.plan_url) : ui.toast("Ссылка скоро будет добавлена", "info")}
          style={{ width: "100%", marginTop: 14, display: "flex", alignItems: "center", gap: 14, padding: "18px 20px", textAlign: "left", background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 16%, var(--surface)), color-mix(in srgb, var(--primary) 7%, var(--surface)))" }}>
          <span style={{ width: 52, height: 52, borderRadius: 15, flex: "0 0 52px", background: "var(--surface)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-sm)" }}>
            <Ic name="weight" size={26} sw={1.9} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 800, fontSize: 16.5, lineHeight: 1.3 }}>Похудеть без жёстких диет - реально</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--primary)", fontWeight: 800, fontSize: 14.5, marginTop: 6 }}>
              Авторский план тренировок <Ic name="chevronRight" size={16} sw={2.4} />
            </span>
          </span>
        </button>
      )}

      {/* История */}
      <div className="row-between" style={{ margin: "26px 0 12px" }}>
        <h2 className="sec-title">История</h2>
        <button className="tap" onClick={() => navigate("/history")} style={{ color: "var(--primary)", fontWeight: 700, fontSize: 15 }}>Все</button>
      </div>
      {recent.length ? (
        <div className="card" style={{ overflow: "hidden", padding: "4px 0" }}>
          {recent.map((g, i) => (
            <div key={g.key}>
              <HistoryRow group={g} tz={tz} onClick={() => openMealGroup(ui, g, onChange, tz)} />
              {i < recent.length - 1 && <div className="hist-div" />}
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <EmptyState
            icon="camera"
            title="Пока нет записей"
            sub="Сфотографируйте еду кнопкой камеры или опишите блюдо текстом - AI посчитает КБЖУ."
            action="Добавить текстом"
            actionIcon="sparkles"
            onAction={() => openAddByText(ui, onChange, tz, (reason) => navigate("/paywall", { state: { reason } }))}
          />
        </div>
      )}
    </div>
  );
}
