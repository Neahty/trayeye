import { useState, useRef, useEffect } from "react";
import { Ic, MEAL_LABELS } from "../components/icons";
import { Scan } from "../api";
import { defaultMeal } from "./meal";

const EXAMPLES = ["Тарелка борща со сметаной", "Капучино на овсяном", "Греческий салат", "Гречка с куриной грудкой", "Сырники со сметаной"];

function MacroPill({ color, label, val }) {
  return (
    <div style={{ flex: 1, textAlign: "center", padding: "10px 4px", borderRadius: 14, background: "var(--surface-2)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <span className="dot" style={{ background: color }} />
        <span style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4 }}>{Math.round(Number(val) || 0)} г</div>
    </div>
  );
}

function AddByTextBody({ close, ui, onAdded, tz }) {
  const [stage, setStage] = useState("input");
  const [text, setText] = useState("");
  const [meal, setMeal] = useState(defaultMeal(tz));
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [chips, setChips] = useState(EXAMPLES.slice(0, 4));
  const [chipKind, setChipKind] = useState("popular"); // "recent" | "popular"
  const ref = useRef();

  useEffect(() => {
    const id = setTimeout(() => ref.current && ref.current.focus(), 420);
    return () => clearTimeout(id);
  }, [stage]);

  // Подсказки-чипы: есть история → последние блюда пользователя; иначе → популярные.
  // Грузим один раз при открытии формы. При ошибке остаёмся на EXAMPLES.
  useEffect(() => {
    let alive = true;
    Scan.suggestions().then((d) => {
      if (!alive) return;
      const recent = Array.isArray(d?.recent) ? d.recent : [];
      const popular = Array.isArray(d?.popular) ? d.popular : [];
      if (recent.length) { setChips(recent.slice(0, 6)); setChipKind("recent"); }
      else if (popular.length) { setChips(popular.slice(0, 4)); setChipKind("popular"); }
    }).catch(() => { /* нет сети — остаёмся на EXAMPLES */ });
    return () => { alive = false; };
  }, []);

  const analyze = async (q) => {
    const query = (q || text).trim();
    if (!query) return;
    setText(query);
    setErr(null);
    setStage("loading");
    try {
      const data = await Scan.text({ description: query, meal_type: meal });
      setRes(data.scan);
      setStage("result");
      onAdded && onAdded();
    } catch (e) {
      const d = e?.response?.data;
      if (e?.response?.status === 403 && d?.error === "limit") {
        close();
        ui.toast("Лимит исчерпан — оформите подписку");
        return;
      }
      if (e?.response?.status === 422) {
        setErr("Не удалось распознать блюдо. Опишите подробнее, что вы съели.");
      } else {
        setErr("Ошибка AI: " + (d?.detail || d?.error || e.message));
      }
      setStage("input");
    }
  };

  if (stage === "loading") {
    return (
      <div>
        <div className="grip" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: "30px 0 40px" }}>
          <div className="spinner" />
          <div style={{ fontSize: 18, fontWeight: 700 }}>AI анализирует блюдо…</div>
          <div style={{ fontSize: 15, color: "var(--text-2)", textAlign: "center", maxWidth: 260 }}>«{text}»</div>
        </div>
      </div>
    );
  }

  if (stage === "result" && res) {
    return (
      <div className="pop-in">
        <div className="grip" />
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--green-ink)", fontWeight: 700, fontSize: 14.5, marginBottom: 10 }}>
          <Ic name="sparkles" size={18} sw={2} /> AI распознал блюдо · {MEAL_LABELS[res.meal_type]}
        </div>
        <h3 className="sheet-h">{res.dish_name}</h3>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "6px 0 18px" }}>
          <span style={{ fontSize: 40, fontWeight: 800, color: "var(--primary)", lineHeight: 1 }}>{res.calories}</span>
          <span style={{ fontSize: 17, color: "var(--text-2)", fontWeight: 600 }}>ккал</span>
        </div>
        <div style={{ display: "flex", gap: 9, marginBottom: 20 }}>
          <MacroPill color="var(--green)" label="Белки" val={res.protein} />
          <MacroPill color="var(--amber)" label="Жиры" val={res.fat} />
          <MacroPill color="var(--blue)" label="Углеводы" val={res.carbs} />
        </div>
        <button className="sheet-btn" onClick={() => { close(); ui.toast(res.dish_name + " добавлено · " + res.calories + " ккал", "check"); }}>
          <Ic name="check" size={21} sw={2.4} /> Готово
        </button>
        <button
          className="sheet-btn ghost"
          onClick={async () => {
            try { await Scan.remove(res.id); ui.toast("Удалено"); onAdded && onAdded(); } catch { /* ignore */ }
            setStage("input"); setText(""); setRes(null);
          }}
        >
          Это не то — изменить описание
        </button>
      </div>
    );
  }

  // input
  return (
    <div className="pop-in">
      <div className="grip" />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <span className="ai-spark" style={{ width: 42, height: 42, flex: "0 0 42px", borderRadius: 13 }}>
          <Ic name="sparkles" size={24} sw={1.9} style={{ color: "#fff" }} />
        </span>
        <h3 className="sheet-h" style={{ margin: 0 }}>Добавить блюдо текстом</h3>
      </div>
      <p className="sheet-sub" style={{ marginTop: 8 }}>Опишите, что вы съели — AI сам посчитает калории и БЖУ</p>

      <input
        ref={ref} className="sheet-input" value={text} placeholder="Например: тарелка борща со сметаной"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") analyze(); }}
      />

      {err && <div style={{ color: "var(--red)", fontSize: 14, fontWeight: 600, margin: "-12px 0 14px" }}>{err}</div>}

      <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.45, margin: "10px 0 16px" }}>
        Текстом — быстро, но менее точно, чем по фото: AI не видит само блюдо. Проверьте КБЖУ после расчёта.
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {["breakfast", "lunch", "dinner", "snack"].map((m) => (
          <button
            key={m} className="tap" onClick={() => setMeal(m)}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 12, fontSize: 12.5, fontWeight: 700,
              background: meal === m ? "var(--tint)" : "var(--surface-2)",
              color: meal === m ? "var(--primary)" : "var(--text-2)"
            }}
          >
            {MEAL_LABELS[m]}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)", margin: "0 0 8px" }}>
        {chipKind === "recent" ? "Недавнее" : "Популярное"}
      </div>
      <div style={{ display: "flex", gap: 9, overflowX: "auto", margin: "0 0 20px", paddingBottom: 4, scrollbarWidth: "none" }}>
        {chips.map((x) => (
          <button key={x} className="ex-chip" onClick={() => { setText(x); ref.current?.focus(); }}>{x}</button>
        ))}
      </div>

      <button className="sheet-btn" onClick={() => analyze()}>
        <Ic name="sparkles" size={20} sw={2} /> Посчитать КБЖУ
      </button>
    </div>
  );
}

export function openAddByText(ui, onAdded, tz) {
  ui.sheet({ type: "custom", render: (close) => <AddByTextBody close={close} ui={ui} onAdded={onAdded} tz={tz} /> });
}
