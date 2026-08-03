import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { Ic } from "../components/icons";
import NumberPicker from "../components/NumberPicker";

const UIContext = createContext(null);
export const useUI = () => useContext(UIContext);

function Header({ cfg }) {
  return (
    <>
      <div className="grip" />
      {cfg.title && <h3 className="sheet-h">{cfg.title}</h3>}
      {cfg.sub && <p className="sheet-sub">{cfg.sub}</p>}
    </>
  );
}

function OptionsSheet({ cfg, close }) {
  return (
    <div>
      <Header cfg={cfg} />
      {cfg.options.map((o) => (
        <button
          key={String(o.value)}
          className={"opt" + (o.value === cfg.value ? " sel" : "")}
          onClick={() => { cfg.onPick && cfg.onPick(o.value); close(); }}
        >
          {o.icon && <span className="opt-ic"><Ic name={o.icon} size={21} sw={1.9} /></span>}
          <span>{o.label}</span>
          {o.value === cfg.value && <span className="check"><Ic name="check" size={22} sw={2.6} /></span>}
        </button>
      ))}
    </div>
  );
}

function StepperSheet({ cfg, close }) {
  const [v, setV] = useState(cfg.value ?? 0);
  return (
    <div>
      <Header cfg={cfg} />
      <NumberPicker
        value={v}
        min={cfg.min ?? -1e9}
        max={cfg.max ?? 1e9}
        step={cfg.step || 1}
        unit={cfg.unit || ""}
        fmt={cfg.fmt}
        onChange={setV}
      />
      <button className="sheet-btn" onClick={() => { cfg.onSave && cfg.onSave(v); close(); }}>
        <Ic name="check" size={21} sw={2.4} /> Сохранить
      </button>
    </div>
  );
}

function TextSheet({ cfg, close }) {
  const [v, setV] = useState(cfg.value || "");
  const ref = useRef();
  useEffect(() => {
    const id = setTimeout(() => ref.current && ref.current.focus(), 420);
    return () => clearTimeout(id);
  }, []);
  return (
    <div>
      <Header cfg={cfg} />
      <input
        ref={ref} className="sheet-input" value={v} placeholder={cfg.placeholder || ""}
        type={cfg.inputType || "text"}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { cfg.onSave && cfg.onSave(v); close(); } }}
      />
      <button className="sheet-btn" onClick={() => { cfg.onSave && cfg.onSave(v); close(); }}>
        <Ic name="check" size={21} sw={2.4} /> Сохранить
      </button>
    </div>
  );
}

function SwatchSheet({ cfg, close }) {
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return (
    <div>
      <Header cfg={cfg} />
      <div className="sw-grid">
        {cfg.options.map((pal, i) => (
          <button
            key={i}
            className={"sw" + (eq(pal, cfg.value) ? " sel" : "")}
            style={{ background: `linear-gradient(135deg, ${pal[2] || pal[0]}, ${pal[0]})`, color: pal[0] }}
            onClick={() => { cfg.onPick && cfg.onPick(pal); close(); }}
          >
            {eq(pal, cfg.value) && <span className="sw-ck"><Ic name="check" size={22} sw={3} /></span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function InfoSheet({ cfg, close }) {
  return (
    <div>
      <Header cfg={cfg} />
      {cfg.body && <div style={{ fontSize: 16, lineHeight: 1.55, color: "var(--text)", marginBottom: 22 }}>{cfg.body}</div>}
      <button className="sheet-btn" onClick={() => { cfg.onAction && cfg.onAction(); close(); }}>
        {cfg.actionIcon && <Ic name={cfg.actionIcon} size={21} sw={2.2} />}
        {cfg.actionLabel || "Понятно"}
      </button>
      {cfg.secondaryLabel && (
        <button className="sheet-btn ghost" onClick={() => { cfg.onSecondary && cfg.onSecondary(); close(); }}>
          {cfg.secondaryLabel}
        </button>
      )}
    </div>
  );
}

function SheetBody({ cfg, close }) {
  switch (cfg.type) {
    case "options": return <OptionsSheet cfg={cfg} close={close} />;
    case "stepper": return <StepperSheet cfg={cfg} close={close} />;
    case "text": return <TextSheet cfg={cfg} close={close} />;
    case "swatch": return <SwatchSheet cfg={cfg} close={close} />;
    case "info": return <InfoSheet cfg={cfg} close={close} />;
    case "custom": return cfg.render(close);
    default: return null;
  }
}

export function UIProvider({ children }) {
  const [sheet, setSheet] = useState(null);
  const [shown, setShown] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [scan, setScan] = useState(null);
  const closeTimer = useRef(null);

  const closeSheet = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setShown(false);
    closeTimer.current = setTimeout(() => { setSheet(null); closeTimer.current = null; }, 420);
  }, []);

  const openSheet = useCallback((cfg) => {
    // Отменяем отложенное закрытие предыдущего листа, иначе оно сотрёт новый
    // (например при переходе «детали блюда» → «редактировать»).
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setSheet({ cfg });
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
  }, []);

  const toast = useCallback((text, icon) => {
    const id = Math.random();
    // На экране держим максимум 2 тоста — самые старые выталкиваем
    setToasts((ts) => [...ts, { id, text, icon, in: false }].slice(-2));
    requestAnimationFrame(() => setToasts((ts) => ts.map((x) => (x.id === id ? { ...x, in: true } : x))));
    setTimeout(() => setToasts((ts) => ts.map((x) => (x.id === id ? { ...x, in: false } : x))), 2200);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 2600);
  }, []);

  // Показ оверлея сканирования. Возвращает функцию остановки.
  const showScan = useCallback(() => {
    setScan({ in: false });
    requestAnimationFrame(() => setScan((s) => s && { ...s, in: true }));
    return () => {
      setScan((s) => (s ? { ...s, in: false } : s));
      setTimeout(() => setScan(null), 350);
    };
  }, []);

  const api = { sheet: openSheet, closeSheet, toast, showScan };

  return (
    <UIContext.Provider value={api}>
      {children}

      {sheet && (
        <div
          className={"sheet-back" + (shown ? " in" : "")}
          onClick={(e) => { if (e.target === e.currentTarget) closeSheet(); }}
        >
          <div className="sheet">
            <SheetBody cfg={sheet.cfg} close={closeSheet} />
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="toast-wrap">
          {toasts.map((tt) => (
            <div key={tt.id} className={"toast" + (tt.in ? " in" : "")}>
              {tt.icon && <Ic name={tt.icon} size={18} sw={2.2} />} {tt.text}
            </div>
          ))}
        </div>
      )}

      {scan && (
        <div className={"scan-back" + (scan.in ? " in" : "")}>
          <div className="scan-box">
            <div className="scan-corner" style={{ top: 12, left: 12, borderRight: "none", borderBottom: "none", borderRadius: "10px 0 0 0" }} />
            <div className="scan-corner" style={{ top: 12, right: 12, borderLeft: "none", borderBottom: "none", borderRadius: "0 10px 0 0" }} />
            <div className="scan-corner" style={{ bottom: 12, left: 12, borderRight: "none", borderTop: "none", borderRadius: "0 0 0 10px" }} />
            <div className="scan-corner" style={{ bottom: 12, right: 12, borderLeft: "none", borderTop: "none", borderRadius: "0 0 10px 0" }} />
            <div className="scan-line" />
            <Ic name="camera" size={60} sw={1.3} style={{ color: "rgba(255,255,255,.32)", position: "absolute", inset: 0, margin: "auto" }} />
          </div>
          <div className="scan-txt"><span className="scan-dot" /> Распознаём блюдо…</div>
        </div>
      )}
    </UIContext.Provider>
  );
}
