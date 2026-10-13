import { useState } from "react";
import { qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { isoDate, pct, rub } from "../../lib/format";
import { StatsView } from "../../components/StatsView.jsx";
import { Card, DateInput, DishImage, Status } from "../../components/ui.jsx";

// «Меню товаров» из макета: сколько каждого блюда нужно на день по всем школам.
function Products() {
  const [date, setDate] = useState(isoDate(1));
  const { data, loading, error } = useApi(`/kombinat/products${qs({ date })}`);
  return (
    <>
      <h1>Меню товаров</h1>
      <DateInput value={date} onChange={setDate} />
      <Status loading={loading && !data} error={error} />
      {data && data.products.length === 0 && <p className="muted">На этот день заказов нет.</p>}
      <div className="grid3">
        {data?.products.map((p) => (
          <Card key={p.dish_id}>
            <DishImage src={p.image_url} />
            <div><strong>{p.name}</strong></div>
            <div className="big">{p.portions} шт \ {p.weightKg} кг</div>
            <div className="muted">Школы: {p.school_numbers.join(", ")}</div>
            <div className="muted">{p.supplier_name || "поставщик не указан"}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

export default function KombinatStats() {
  const [from, setFrom] = useState(isoDate(-30));
  const [to, setTo] = useState(isoDate());
  const { data, loading, error } = useApi(`/kombinat/stats${qs({ from, to })}`);

  return (
    <>
      <Products />
      <h2>Статистика</h2>
      <div className="row">
        <DateInput label="С" value={from} onChange={setFrom} />
        <DateInput label="по" value={to} onChange={setTo} />
      </div>
      <Status loading={loading && !data} error={error} />
      {data && (
        <>
          <Card title="По школам">
            <table>
              <thead><tr><th>Школа</th><th>Заказано</th><th>Списано</th><th>Списания</th></tr></thead>
              <tbody>
                {data.schools.map((s) => (
                  <tr key={s.id}><td>{s.name}</td><td>{rub(s.plannedRub)}</td><td>{rub(s.wasteRub)}</td><td>{pct(s.wastePct)}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
          <StatsView data={data} />
        </>
      )}
    </>
  );
}
