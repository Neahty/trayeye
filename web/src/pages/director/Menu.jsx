import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { api, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useDateParam } from "../../lib/hooks";
import { motionTokens, springs } from "../../lib/motion";
import { isoDate, pct } from "../../lib/format";
import { Card, DateInput, Icon, PlusIcon, Status, Tile, Toast, errorText } from "../../components/ui.jsx";

function AddMenuItem({ date, initialDish = "", onAdded }) {
  const { data } = useApi("/director/dishes");
  const [dishId, setDishId] = useState(initialDish);
  const [portions, setPortions] = useState("");
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/director/menu", { date, dish_id: Number(dishId), planned_portions: Number(portions) });
      setMessage(null);
      setPortions("");
      onAdded();
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="row" onSubmit={submit}>
      <select value={dishId} onChange={(e) => setDishId(e.target.value)} required aria-label="Блюдо">
        <option value="">Блюдо...</option>
        {(data?.dishes || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <input type="number" min="0" max="5000" placeholder="Порций" aria-label="Порций" value={portions} onChange={(e) => setPortions(e.target.value)} required />
      <button type="submit" disabled={busy}>+ Добавить меню</button>
      {message && <span className="error">{message}</span>}
    </form>
  );
}

// Демо камеры: фото подноса → нейросеть → остатки по блюдам.
function TrayUpload({ date, onScanned }) {
  const [state, setState] = useState(null);

  const onFile = async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("image", file);
    form.append("date", date);
    setState({ text: "Распознаём...", busy: true });
    try {
      const r = await api.post("/director/tray", form);
      setState({ items: r.items });
      onScanned();
    } catch (err) {
      setState({ text: errorText(err) });
    } finally {
      input.value = "";
    }
  };

  return (
    <Card title="Фото подноса (демо камеры)">
      <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={onFile} disabled={state?.busy} aria-label="Фото подноса" />
      {state?.text && <p className={state.busy ? "muted pulse" : "muted"}>{state.text}</p>}
      {state?.items && (
        <ul>
          {state.items.map((it) => <li key={it.dish_id}>{it.name}: осталось {it.leftover_pct}%</li>)}
        </ul>
      )}
    </Card>
  );
}

export default function DirectorMenu() {
  const [date, setDate] = useDateParam(isoDate());
  const [params, setParams] = useSearchParams();
  // ?add=5 из уведомления «новое блюдо в каталоге»: сразу открыть форму с этим блюдом.
  const addDish = params.get("add") || "";
  const [addOpen, setAddOpen] = useState(Boolean(addDish));
  const [message, setMessage] = useState(null);
  const { data, loading, error, reload } = useApi(`/director/menu${qs({ date })}`);

  useEffect(() => { if (addDish) setAddOpen(true); }, [addDish]);

  const closeAdd = () => {
    setAddOpen(false);
    if (addDish) setParams((prev) => { const copy = new URLSearchParams(prev); copy.delete("add"); return copy; }, { replace: true });
  };

  const remove = async (id) => {
    try {
      await api.del(`/director/menu/${id}`);
      setMessage(null);
    } catch (err) {
      setMessage(errorText(err));
    }
    reload();
  };

  return (
    <>
      <div className="page-heading">
        <h1>Меню</h1>
        <div className="page-tools">
          <DateInput value={date} onChange={setDate} />
          <button className="add-link" onClick={() => (addOpen ? closeAdd() : setAddOpen(true))} aria-expanded={addOpen}>
            <motion.span className="add-link-icon" animate={{ rotate: addOpen ? 45 : 0 }} transition={springs.snappy}><PlusIcon /></motion.span>
            {addOpen ? "Закрыть" : "Добавить меню"}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {addOpen && (
          <motion.div
            key="add"
            initial={{ opacity: 0, y: -motionTokens.distance.sm }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -motionTokens.distance.sm, transition: { duration: motionTokens.duration.fast } }}
            transition={springs.gentle}
          >
            <Card title="Новое блюдо в меню">
              <AddMenuItem key={addDish} date={date} initialDish={addDish} onAdded={() => { reload(); closeAdd(); }} />
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
      <Toast>{message}</Toast>
      <Status loading={loading && !data} error={error} />
      {data && data.items.length === 0 && <p className="muted">На этот день меню нет.</p>}
      <div className="grid3">
        <AnimatePresence mode="popLayout" initial={false}>
          {data?.items.map((it) => (
            <motion.div
              key={`${data.date}-${it.dish_id}`}
              layout="position"
              exit={{ opacity: 0, scale: motionTokens.scale.press, transition: { duration: motionTokens.duration.fast } }}
              transition={springs.gentle}
            >
              <Tile image={it.image_url} title={it.name} value={`${it.planned} шт`} focusId={`dish-${it.dish_id}`}>
                <div className="tile-note tile-eaten"><Icon name="trend" size={13} />{it.eatenPct === null || it.eatenPct === undefined ? "ещё не ели" : `съедают ${pct(it.eatenPct)}`}</div>
                <button className="tile-remove" onClick={() => remove(it.id)} title="Убрать из меню" aria-label={`Убрать ${it.name} из меню`}>×</button>
              </Tile>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <details className="optional-tools"><summary>Распознать остатки по фото подноса</summary><TrayUpload date={date} onScanned={reload} /></details>
    </>
  );
}
