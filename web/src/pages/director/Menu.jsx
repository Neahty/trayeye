import { useState } from "react";
import { api, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { CATEGORY_LABELS, isoDate, pct } from "../../lib/format";
import { Card, DateInput, DishImage, Status, errorText } from "../../components/ui.jsx";

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
  const { data, loading, error, reload } = useApi(`/director/menu${qs({ date })}`);

  const remove = async (id) => {
    await api.del(`/director/menu/${id}`);
    reload();
  };

  return (
    <>
      <h1>Меню</h1>
      <div className="row">
        <DateInput value={date} onChange={setDate} />
      </div>
      <AddMenuItem date={date} onAdded={reload} />
      <Status loading={loading && !data} error={error} />
      {data && data.items.length === 0 && <p className="muted">На этот день меню нет.</p>}
      <div className="grid3">
        {data?.items.map((it) => (
          <Card key={it.dish_id}>
            <DishImage src={it.image_url} />
            <div className="muted">{CATEGORY_LABELS[it.category]}</div>
            <div><strong>{it.name}</strong></div>
            <div className="big">{it.planned} шт</div>
            <div className="muted">Съедают: {pct(it.eatenPct)}</div>
            <button className="link" onClick={() => remove(it.id)}>Убрать</button>
          </Card>
        ))}
      </div>
      <TrayUpload date={date} onScanned={reload} />
    </>
  );
}
