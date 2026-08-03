import { useEffect, useState } from "react";
import { History } from "../api";
import { useApp } from "../AppContext";
import { useUI } from "../ui/UIProvider";
import { Ic, MealIcon, MEAL_LABELS } from "../components/icons";
import PhotoSlot from "../components/PhotoSlot";
import EmptyState from "../components/EmptyState";
import { openMealGroup, mealTime } from "../ui/mealDetail";
import { groupScans, groupTitle } from "../ui/meal";

const DOW = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const DOW_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

// Локальная дата без UTC-сдвига: toISOString() переводил полночь в UTC и для
// поясов восточнее UTC (Москва) отдавал предыдущий день — полоса недели грузила
// чужой день при совпадающем числе в ячейке.
function ymd(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function weekOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday);
    x.setDate(monday.getDate() + i);
    return x;
  });
}

const FILTERS = [
  { id: "all", label: "Все", icon: null },
  { id: "breakfast", label: "Завтрак", icon: "breakfast" },
  { id: "lunch", label: "Обед", icon: "lunch" },
  { id: "dinner", label: "Ужин", icon: "dinner" },
  { id: "snack", label: "Перекусы", icon: "snack" }
];

function MacroCell({ color, label, val }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span className="dot" style={{ background: color }} />
        <span style={{ fontSize: 14, color: "var(--text-2)", fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4, paddingLeft: 16 }}>{Math.round(Number(val) || 0)} г</div>
    </div>
  );
}

// Карточка ПРИЁМА: одно фото, сумма КБЖУ и список блюд (одно фото = одна карточка).
function HistoryCard({ group, onClick, tz }) {
  const multi = group.dishes.length > 1;
  return (
    <button className="card card-press fade-in" onClick={onClick}
      style={{ padding: 14, display: "flex", flexDirection: "column", gap: 13, width: "100%", textAlign: "left" }}>
      <div style={{ display: "flex", gap: 14 }}>
        <PhotoSlot meal={{ ...group, dish_name: groupTitle(group) }} width={90} height={90} radius={15} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 17.5, lineHeight: 1.25 }}>{multi ? MEAL_LABELS[group.meal_type] : group.dishes[0].dish_name}</div>
              <div style={{ color: "var(--text-2)", fontSize: 14.5, marginTop: 4 }}>
                {mealTime(group, tz)}{multi ? ` · ${group.dishes.length} блюд` : ` · ${MEAL_LABELS[group.meal_type]}`}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 4, flex: "0 0 auto" }}>
              <span style={{ color: "var(--primary)", fontWeight: 800, fontSize: 17 }}>{group.calories}</span>
              <span style={{ color: "var(--primary)", fontWeight: 600, fontSize: 14 }}>ккал</span>
              <Ic name="chevronRight" size={18} sw={2.2} style={{ color: "var(--text-3)", marginTop: 1 }} />
            </div>
          </div>
          {multi && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
              {group.dishes.slice(0, 3).map((d) => (
                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, color: "var(--text-2)" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>• {d.dish_name}</span>
                  <span style={{ flex: "0 0 auto", fontWeight: 600 }}>{d.calories}</span>
                </div>
              ))}
              {group.dishes.length > 3 && <div style={{ fontSize: 13, color: "var(--text-3)" }}>ещё {group.dishes.length - 3}…</div>}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, paddingTop: 2 }}>
        <MacroCell color="var(--green)" label="Белки" val={group.protein} />
        <MacroCell color="var(--amber)" label="Жиры" val={group.fat} />
        <MacroCell color="var(--blue)" label="Углеводы" val={group.carbs} />
      </div>
    </button>
  );
}

export default function HistoryPage() {
  const { dataVersion, bumpData, profile } = useApp();
  const tz = profile?.user?.timezone || "Europe/Moscow";
  const ui = useUI();
  // «Сегодня» из server_today (полный ICU на сервере); клиентский Intl ненадёжен в webview.
  const today = profile?.server_today || new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const [date, setDate] = useState(today);
  const [data, setData] = useState(null);
  const [active, setActive] = useState("all");
  const [sort, setSort] = useState("time");

  async function load() { setData(await History.byDate(date)); }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [date, dataVersion]);

  const onChange = () => bumpData();
  const week = weekOf(date);

  const allMeals = data ? [...data.meals.breakfast, ...data.meals.lunch, ...data.meals.dinner, ...data.meals.snack] : [];
  const filtered = active === "all" ? allMeals : (data?.meals[active] || []);
  // Одно фото/текст = одна карточка-приём: схлопываем блюда по batch_id.
  const visible = groupScans(filtered).sort((a, b) =>
    sort === "kcal" ? b.calories - a.calories : new Date(a.scanned_at) - new Date(b.scanned_at)
  );
  const kcalFor = (id) => id === "all"
    ? allMeals.reduce((a, m) => a + (m.calories || 0), 0)
    : (data?.meals[id] || []).reduce((a, m) => a + (m.calories || 0), 0);
  const total = data?.total || { calories: 0, protein: 0, fat: 0, carbs: 0 };

  const openSort = () => ui.sheet({
    type: "options", title: "Сортировка", value: sort,
    options: [{ value: "time", label: "По времени", icon: "clock" }, { value: "kcal", label: "По калориям", icon: "flame" }],
    onPick: (v) => { setSort(v); ui.toast(v === "kcal" ? "По калориям" : "По времени"); }
  });

  return (
    <div className="screen fade-in">
      <div className="row-between" style={{ padding: "0 0 16px", alignItems: "center" }}>
        <h1 className="h-title">История</h1>
        <button className="icon-btn tap" onClick={openSort}><Ic name="filter" size={21} sw={1.7} /></button>
      </div>

      {/* week strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 16 }}>
        {week.map((d) => {
          const ds = ymd(d);
          const isActive = ds === date;
          const wknd = d.getDay() === 0 || d.getDay() === 6;
          // «Будущее» — строго после серверного «сегодня» (в поясе пользователя), а не по локальной
          // полуночи телефона: иначе западнее сервера можно было выбрать «завтра» и увидеть пустой день.
          const future = ds > today;
          const numColor = isActive ? "#fff" : wknd ? "var(--red)" : future ? "var(--text-3)" : "var(--text)";
          const labColor = isActive ? "rgba(255,255,255,.85)" : wknd ? "var(--red)" : "var(--text-2)";
          return (
            <button key={ds} className={"day-cell tap" + (isActive ? " active" : "")} disabled={future}
              onClick={() => setDate(ds)} style={{ background: isActive ? undefined : "none", opacity: future ? 0.45 : 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: labColor }}>{DOW_SHORT[d.getDay()]}</div>
              <div style={{ fontSize: 21, fontWeight: 800, color: numColor, marginTop: 2 }}>{d.getDate()}</div>
              {isActive && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff", marginTop: 3 }} />}
            </button>
          );
        })}
      </div>

      {/* total */}
      <div className="card" style={{ padding: "16px 18px", background: "var(--tint)", display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <span style={{ fontSize: 26 }}>🔥</span>
        <div style={{ flex: "0 0 auto" }}>
          <div style={{ fontSize: 14.5, color: "var(--text-2)", fontWeight: 600 }}>Итого за день</div>
          <div style={{ fontSize: 23, fontWeight: 800, color: "var(--primary)" }}>{total.calories} ккал</div>
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: 16 }}>
          {[["Б", total.protein, "var(--green)"], ["Ж", total.fat, "var(--amber)"], ["У", total.carbs, "var(--blue)"]].map(([l, v, c]) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, color: c, fontWeight: 700 }}>{l}</div>
              <div style={{ fontSize: 16.5, fontWeight: 700, marginTop: 3 }}>{Math.round(Number(v) || 0)} г</div>
            </div>
          ))}
        </div>
      </div>

      {/* filters */}
      <div className="filter-scroll">
        {FILTERS.map((f) => {
          const on = active === f.id;
          return (
            <button key={f.id} className={"filter-chip" + (on ? " active" : "")} onClick={() => setActive(f.id)}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: on ? "var(--primary)" : "var(--text-2)" }}>{f.label}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 3 }}>
                {f.icon && <MealIcon kind={f.icon} size={17} />}
                <span style={{ fontWeight: 800, fontSize: 15.5, color: on ? "var(--primary)" : "var(--text)" }}>{kcalFor(f.id)}</span>
                <span style={{ fontSize: 13, color: on ? "var(--primary)" : "var(--text-2)", fontWeight: 600 }}>ккал</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* meal cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 18 }}>
        {visible.length ? (
          visible.map((g) => <HistoryCard key={g.key} group={g} tz={tz} onClick={() => openMealGroup(ui, g, onChange, tz)} />)
        ) : (
          <EmptyState
            icon="utensils"
            title={active === "all" ? "Нет записей за этот день" : "Нет блюд в этой категории"}
            sub={active === "all" ? "Добавьте приём пищи через камеру или текстом — он появится здесь." : "Выберите другую категорию или добавьте блюдо."}
          />
        )}
      </div>
    </div>
  );
}
