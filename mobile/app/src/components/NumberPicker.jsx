import { useEffect, useRef, useState } from "react";
import { Ic } from "./icons";

// Управляемый пикер числа: тап по числу - ввод с клавиатуры,
// удержание +/− - ускоренное изменение. Одиночный тап = шаг.
export default function NumberPicker({ value, min = -1e9, max = 1e9, step = 1, unit = "", fmt, onChange }) {
  const clamp = (x) => Math.min(max, Math.max(min, x));
  const hold = useRef(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Чистим таймеры удержания при размонтировании
  useEffect(() => () => stop(), []);

  function stop() {
    if (hold.current) {
      clearTimeout(hold.current);
      hold.current = null;
    }
  }

  // Одиночный шаг сразу + ускоряющийся повтор при удержании
  function start(dir) {
    let cur = clamp(value + dir * step);
    onChange(cur);
    let delay = 320;
    const tick = () => {
      cur = clamp(cur + dir * step);
      onChange(cur);
      delay = Math.max(45, delay - 35); // постепенное ускорение
      hold.current = setTimeout(tick, delay);
    };
    hold.current = setTimeout(tick, delay + 120);
  }

  const commit = () => {
    setEditing(false);
    const n = Number(String(draft).replace(/[^\d-]/g, ""));
    if (!Number.isNaN(n) && draft !== "") onChange(clamp(n));
  };

  const Btn = (dir, name) => (
    <button
      className="step-btn"
      onPointerDown={(e) => { e.preventDefault(); start(dir); }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Ic name={name} size={26} sw={2.6} />
    </button>
  );

  return (
    <div className="stepper">
      {Btn(-1, "minus")}
      <div className="step-val">
        {editing ? (
          <input
            className="step-num step-input"
            type="number"
            inputMode="numeric"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        ) : (
          <button
            className="step-num"
            style={{ background: "none", display: "block", margin: "0 auto" }}
            onClick={() => { setDraft(String(value)); setEditing(true); }}
          >
            {fmt ? fmt(value) : value}
          </button>
        )}
        <div className="step-unit">{unit}</div>
      </div>
      {Btn(1, "plus")}
    </div>
  );
}
