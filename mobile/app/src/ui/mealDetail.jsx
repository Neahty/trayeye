import { useState } from "react";
import { Ic } from "../components/icons";
import { MEAL_LABELS } from "../components/icons";
import PhotoSlot from "../components/PhotoSlot";
import { Scan, Trainer } from "../api";
import { groupTitle } from "./meal";

export function mealTime(scan, tz) {
  // Приоритет - time_label, посчитанный на сервере в поясе пользователя (надёжно,
  // полный ICU). Telegram-webview с урезанным ICU молча форматил зоны в UTC.
  if (scan?.time_label) return scan.time_label;
  if (!scan?.scanned_at) return "";
  try {
    const opts = { hour: "2-digit", minute: "2-digit", timeZone: tz || "Europe/Moscow" };
    return new Date(scan.scanned_at).toLocaleTimeString("ru-RU", opts);
  } catch {
    return "";
  }
}

function Macro({ color, label, val, total }) {
  const pct = total ? Math.min(100, (Number(val) / total) * 100) : 0;
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span className="dot" style={{ background: color }} />
        <span style={{ fontSize: 14, color: "var(--text-2)", fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 5, paddingLeft: 16 }}>{Math.round(Number(val) || 0)} г</div>
      <div style={{ height: 6, borderRadius: 4, background: "var(--track)", overflow: "hidden", marginTop: 7 }}>
        <div style={{ height: "100%", width: pct + "%", background: color, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function EditForm({ scan, close, ui, onChange }) {
  const [f, setF] = useState({
    dish_name: scan.dish_name || "",
    calories: scan.calories || 0,
    protein: Math.round(Number(scan.protein) || 0),
    fat: Math.round(Number(scan.fat) || 0),
    carbs: Math.round(Number(scan.carbs) || 0),
    meal_type: scan.meal_type || "snack"
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      await Scan.update(scan.id, {
        dish_name: f.dish_name,
        calories: Number(f.calories),
        protein: Number(f.protein),
        fat: Number(f.fat),
        carbs: Number(f.carbs),
        meal_type: f.meal_type
      });
      close();
      ui.toast("Изменения сохранены", "check");
      onChange && onChange();
    } catch (err) {
      // Сервер отбивает отрицательные и нечисловые значения - говорим за что, а не «не вышло».
      ui.toast(err?.response?.data?.error === "bad_number"
        ? "Проверьте числа: только положительные значения"
        : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const field = (label, k, type = "number") => (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ fontSize: 13.5, color: "var(--text-2)", fontWeight: 600, marginLeft: 4 }}>{label}</span>
      <input className="sheet-input" style={{ margin: "6px 0 0" }} type={type} value={f[k]} onChange={set(k)} />
    </label>
  );

  return (
    <div>
      <div className="grip" />
      <h3 className="sheet-h" style={{ marginBottom: 16 }}>Редактировать</h3>
      {field("Название", "dish_name", "text")}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>{field("Ккал", "calories")}</div>
        <div style={{ flex: 1 }}>{field("Белки", "protein")}</div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>{field("Жиры", "fat")}</div>
        <div style={{ flex: 1 }}>{field("Углеводы", "carbs")}</div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 13.5, color: "var(--text-2)", fontWeight: 600, marginLeft: 4 }}>Приём пищи</span>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {["breakfast", "lunch", "dinner", "snack"].map((m) => (
            <button
              key={m}
              className="tap"
              onClick={() => setF((p) => ({ ...p, meal_type: m }))}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 12, fontSize: 13, fontWeight: 700,
                background: f.meal_type === m ? "var(--tint)" : "var(--surface-2)",
                color: f.meal_type === m ? "var(--primary)" : "var(--text-2)"
              }}
            >
              {MEAL_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      <button className="sheet-btn" disabled={busy} onClick={save}>
        <Ic name="check" size={20} sw={2.4} /> Сохранить
      </button>
    </div>
  );
}

// Кнопка удаления блокируется на время запроса: без этого повторные тапы слали
// DELETE по уже удалённому id и пользователь ловил ошибку на успешное действие.
function DeleteButton({ scan, close, ui, onChange }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="sheet-btn ghost"
      disabled={busy}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await Scan.remove(scan.id);
          close();
          ui.toast("Блюдо удалено", "check");
          onChange && onChange();
        } catch (err) {
          // 404 - блюда уже нет (например, удалили с другого устройства): это тоже успех.
          if (err?.response?.status === 404) {
            close();
            ui.toast("Блюдо удалено", "check");
            onChange && onChange();
          } else {
            ui.toast("Не удалось удалить");
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <Ic name="trash" size={19} sw={2} /> Удалить из истории
    </button>
  );
}

// Простая сводка одного макроса (без прогресс-бара) - для суммы по приёму.
function MacroSum({ color, label, val }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span className="dot" style={{ background: color }} />
        <span style={{ fontSize: 14, color: "var(--text-2)", fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 5, paddingLeft: 16 }}>{Math.round(Number(val) || 0)} г</div>
    </div>
  );
}

// Детали ПРИЁМА: фото один раз, сумма КБЖУ, список блюд.
// Обычный режим - тап по блюду открывает его карточку (правка/удаление).
// Тренерский режим (opts.trainer) - у каждого блюда кнопка «Комментарий».
export function openMealGroup(ui, group, onChange, tz, opts = {}) {
  const trainer = !!opts.trainer;
  const single = group.dishes.length === 1;
  // Один блюдо без тренерского режима - открываем привычную карточку блюда.
  if (single && !trainer) return openMealDetail(ui, group.dishes[0], onChange, tz);

  const commentDish = (scan) => ui.sheet({
    type: "text", title: `Комментарий к «${scan.dish_name}»`, value: scan.trainer_comment || "",
    placeholder: "Ваш комментарий клиенту",
    onSave: async (v) => {
      if (!v.trim()) return;
      try { await Trainer.comment(scan.id, v.trim()); ui.toast("Комментарий отправлен", "check"); onChange && onChange(); }
      catch { ui.toast("Не удалось отправить"); }
    }
  });

  ui.sheet({
    type: "custom",
    render: (close) => (
      <div>
        <div className="grip" />
        <PhotoSlot meal={{ ...group, dish_name: groupTitle(group) }} width="100%" height={170} radius={20} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginTop: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h3 className="sheet-h" style={{ marginBottom: 6 }}>{MEAL_LABELS[group.meal_type] || "Приём пищи"}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)", fontSize: 15, fontWeight: 600 }}>
              <Ic name="clock" size={17} sw={1.9} /> {mealTime(group, tz)}
              <span style={{ color: "var(--text-3)" }}>· {group.dishes.length} блюд</span>
            </div>
          </div>
          <div style={{ textAlign: "right", flex: "0 0 auto" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "var(--primary)", lineHeight: 1 }}>{group.calories}</div>
            <div style={{ fontSize: 14, color: "var(--text-2)", fontWeight: 600 }}>ккал</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, margin: "18px 0 6px" }}>
          <MacroSum color="var(--green)" label="Белки" val={group.protein} />
          <MacroSum color="var(--amber)" label="Жиры" val={group.fat} />
          <MacroSum color="var(--blue)" label="Углеводы" val={group.carbs} />
        </div>

        <div style={{ fontSize: 13.5, color: "var(--text-2)", fontWeight: 700, margin: "16px 4px 8px" }}>Блюда</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {group.dishes.map((d) => (
            <div key={d.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15.5 }}>{d.dish_name}</div>
                  <div style={{ color: "var(--text-2)", fontSize: 13, marginTop: 3 }}>
                    Б {Math.round(Number(d.protein) || 0)} · Ж {Math.round(Number(d.fat) || 0)} · У {Math.round(Number(d.carbs) || 0)}
                    {d.weight_grams ? ` · ${d.weight_grams} г` : ""}
                  </div>
                </div>
                <div style={{ color: "var(--primary)", fontWeight: 800, fontSize: 15.5, flex: "0 0 auto" }}>{d.calories} ккал</div>
              </div>
              {d.trainer_comment && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--tint)", borderRadius: 12, fontSize: 13.5, color: "var(--text)" }}>
                  💬 {d.trainer_comment}
                </div>
              )}
              {trainer ? (
                <button className="sheet-btn ghost" style={{ marginTop: 8, height: 42, fontSize: 14.5 }} onClick={() => commentDish(d)}>
                  <Ic name="edit" size={17} sw={2} /> {d.trainer_comment ? "Изменить комментарий" : "Комментарий"}
                </button>
              ) : (
                <button className="sheet-btn ghost" style={{ marginTop: 8, height: 42, fontSize: 14.5 }}
                  onClick={() => { close(); openMealDetail(ui, d, onChange, tz); }}>
                  <Ic name="edit" size={17} sw={2} /> Открыть блюдо
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  });
}

export function openMealDetail(ui, scan, onChange, tz) {
  ui.sheet({
    type: "custom",
    render: (close) => (
      <div>
        <div className="grip" />
        <PhotoSlot meal={scan} width="100%" height={180} radius={20} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginTop: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h3 className="sheet-h" style={{ marginBottom: 6 }}>{scan.dish_name}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)", fontSize: 15, fontWeight: 600 }}>
              <Ic name="clock" size={17} sw={1.9} /> {mealTime(scan, tz)}
              {scan.source === "text" && <span style={{ color: "var(--primary)" }}>· AI текст</span>}
              {scan.source === "photo" && <span style={{ color: "var(--primary)" }}>· AI фото</span>}
            </div>
          </div>
          <div style={{ textAlign: "right", flex: "0 0 auto" }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "var(--primary)", lineHeight: 1 }}>{scan.calories}</div>
            <div style={{ fontSize: 14, color: "var(--text-2)", fontWeight: 600 }}>ккал</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, margin: "20px 0" }}>
          <Macro color="var(--green)" label="Белки" val={scan.protein} total={80} />
          <Macro color="var(--amber)" label="Жиры" val={scan.fat} total={60} />
          <Macro color="var(--blue)" label="Углеводы" val={scan.carbs} total={120} />
        </div>
        {scan.trainer_comment && (
          <div style={{ marginBottom: 16, padding: "10px 12px", background: "var(--tint)", borderRadius: 12, fontSize: 14, color: "var(--text)" }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--primary)" }}>💬 Комментарий тренера</div>
            {scan.trainer_comment}
          </div>
        )}
        <button
          className="sheet-btn"
          onClick={() => ui.sheet({ type: "custom", render: (c) => <EditForm scan={scan} close={c} ui={ui} onChange={onChange} /> })}
        >
          <Ic name="edit" size={20} sw={2} /> Редактировать
        </button>
        <DeleteButton scan={scan} close={close} ui={ui} onChange={onChange} />
      </div>
    )
  });
}
