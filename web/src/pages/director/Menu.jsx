import { useState } from "react";
import { api, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { isoDate, pct } from "../../lib/format";
import { Card, DateInput, Icon, PlusIcon, Status, Tile, errorText } from "../../components/ui.jsx";

function AddMenuItem({ date, onAdded }) {
  const { data } = useApi("/director/dishes");
  const [dishId, setDishId] = useState("");
  const [portions, setPortions] = useState("");
  const [message, setMessage] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/director/menu", { date, dish_id: Number(dishId), planned_portions: Number(portions) });
      setMessage(null);
      setPortions("");
      onAdded();
    } catch (err) {
      setMessage(errorText(err));
    }
  };

  return (
    <form className="row" onSubmit={submit}>
      <select value={dishId} onChange={(e) => setDishId(e.target.value)} required>
        <option value="">Блюдо...</option>
        {(data?.dishes || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <input type="number" min="0" placeholder="Порций" value={portions} onChange={(e) => setPortions(e.target.value)} required />
      <button type="submit">+ Добавить меню</button>
      {message && <span className="error">{message}</span>}
    </form>
  );
}

// Демо камеры: фото подноса → нейросеть → остатки по блюдам.
function TrayUpload({ date, onScanned }) {
  const [state, setState] = useState(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("image", file);
    form.append("date", date);
    setState({ text: "Распознаём..." });
    try {
      const r = await api.post("/director/tray", form);
      setState({ items: r.items });
      onScanned();
    } catch (err) {
      setState({ text: errorText(err) });
    } finally {
      e.target.value = "";
    }
  };

  return (
    <Card title="Фото подноса (демо камеры)">
      <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={onFile} />
      {state?.text && <p className="muted">{state.text}</p>}
      {state?.items && (
        <ul>
          {state.items.map((it) => <li key={it.dish_id}>{it.name}: осталось {it.leftover_pct}%</li>)}
        </ul>
      )}
    </Card>
  );
}

export default function DirectorMenu() {
  const [date, setDate] = useState(isoDate());
  const [addOpen, setAddOpen] = useState(false);
  const { data, loading, error, reload } = useApi(`/director/menu${qs({ date })}`);

  const remove = async (id) => {
    await api.del(`/director/menu/${id}`);
    reload();
  };

  return (
    <>
      <div className="page-heading">
        <h1>Меню</h1>
        <div className="page-tools">
          <DateInput value={date} onChange={setDate} />
          <button className="add-link" onClick={() => setAddOpen(!addOpen)}><PlusIcon />{addOpen ? "Закрыть" : "Добавить меню"}</button>
        </div>
      </div>
      {addOpen && <Card title="Новое блюдо в меню"><AddMenuItem date={date} onAdded={() => { reload(); setAddOpen(false); }} /></Card>}
      <Status loading={loading && !data} error={error} />
      {data && data.items.length === 0 && <p className="muted">На этот день меню нет.</p>}
      <div className="grid3">
        {data?.items.map((it) => (
          <Tile
            key={it.dish_id}
            image={it.image_url}
            title={it.name}
            value={`${it.planned} шт`}
          >
            <div className="tile-note tile-eaten"><Icon name="trend" size={13} />{it.eatenPct === null || it.eatenPct === undefined ? "ещё не ели" : `съедают ${pct(it.eatenPct)}`}</div>
            <button className="tile-remove" onClick={() => remove(it.id)} title="Убрать из меню" aria-label={`Убрать ${it.name} из меню`}>×</button>
          </Tile>
        ))}
      </div>
      <details className="optional-tools"><summary>Распознать остатки по фото подноса</summary><TrayUpload date={date} onScanned={reload} /></details>
    </>
  );
}
