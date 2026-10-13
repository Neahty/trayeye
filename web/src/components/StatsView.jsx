import { CATEGORY_LABELS, dayShort, pct, rub } from "../lib/format";
import { Card } from "./ui.jsx";

// Общая статистика: итоги, ряд по дням и блюда. Графики появятся вместе с дизайном.
export function StatsView({ data }) {
  return (
    <>
      <div className="grid3">
        <Card title="Заказано"><div className="big">{rub(data.summary.plannedRub)}</div></Card>
        <Card title="Списано"><div className="big">{rub(data.summary.wasteRub)}</div></Card>
        <Card title="Списания"><div className="big">{pct(data.summary.wastePct)}</div></Card>
      </div>

      <Card title="Блюда: от нелюбимых к любимым">
        <table>
          <thead><tr><th>Блюдо</th><th>Тип</th><th>Дней в меню</th><th>Съедают</th><th>Списания</th><th>Списано</th></tr></thead>
          <tbody>
            {data.dishes.map((d) => (
              <tr key={d.dish_id}>
                <td>{d.name}</td>
                <td>{CATEGORY_LABELS[d.category]}</td>
                <td>{d.days}</td>
                <td>{pct(d.eatenPct)}</td>
                <td>{pct(d.wastePct)}</td>
                <td>{rub(d.wasteRub)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="По дням">
        <table>
          <thead><tr><th>День</th><th>Списания</th><th>Списано</th><th>Пришли</th></tr></thead>
          <tbody>
            {data.series.map((s) => (
              <tr key={s.date}>
                <td>{dayShort(s.date)}</td>
                <td>{pct(s.wastePct)}</td>
                <td>{rub(s.wasteRub)}</td>
                <td>{s.kids.present}/{s.kids.students}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
