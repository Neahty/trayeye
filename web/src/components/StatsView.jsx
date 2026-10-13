import { CATEGORY_LABELS, dayShort, pct, rub } from "../lib/format";
import { Card, MetricCard } from "./ui.jsx";

function WasteChart({ series }) {
  const values = (series || []).map((item) => Number(item.wastePct) || 0);
  const points = values.length > 1
    ? values.map((v, i) => `${28 + i * (644 / (values.length - 1))},${180 - Math.max(0, Math.min(100, v)) * 1.45}`).join(" ")
    : "28,110 672,110";
  const selected = Math.max(0, values.length - 2);
  const selectedX = values.length > 1 ? 28 + selected * (644 / (values.length - 1)) : 350;

  return (
    <svg className="chart-svg" viewBox="0 0 700 245" role="img" aria-label="График списаний по дням">
      <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#68ee92" stopOpacity=".17" /><stop offset="1" stopColor="#68ee92" stopOpacity="0" /></linearGradient></defs>
      <rect x={selectedX - 29} y="18" width="58" height="184" fill="#edfff2" />
      <polygon className="chart-area" points={`28,202 ${points} 672,202`} />
      <polyline className="chart-line" points={points} />
      {values.length > 0 && <circle cx={selectedX} cy={180 - values[selected] * 1.45} r="7" fill="white" stroke="#3e9a53" strokeWidth="3" />}
      {(series || []).filter((_, i) => i % Math.max(1, Math.ceil((series.length || 1) / 9)) === 0 || i === series.length - 1).map((item) => {
        const i = series.indexOf(item);
        return <text key={item.date} className="chart-tick" x={28 + i * (644 / Math.max(1, values.length - 1))} y="229" textAnchor="middle">{dayShort(item.date)}</text>;
      })}
    </svg>
  );
}

export function StatsView({ data }) {
  const summary = data.summary || {};
  const avgEaten = data.dishes.length
    ? Math.round(data.dishes.reduce((total, dish) => total + (Number(dish.eatenPct) || 0), 0) / data.dishes.length)
    : null;

  return (
    <>
      <div className="grid3">
        <MetricCard kind="waste" title="Списания" value={pct(summary.wastePct)} note={`Списано ${rub(summary.wasteRub)}`} />
        <MetricCard kind="savings" title="Заказано" value={rub(summary.plannedRub)} note="За выбранный период" />
        <MetricCard kind="kids" title="Съедаемость" value={pct(avgEaten)} note="По блюдам за период" blue />
      </div>
      <div className="grid2">
        <Card title="Динамика списаний">
          <div className="chart-card"><div className="toast chart-badge">{pct(summary.wastePct)} списаний</div><WasteChart series={data.series || []} /></div>
        </Card>
        <Card title="Отчёт за период">
          <div className="stats-report">
            <p>Сводка за выбранный период готова к выгрузке. Включены данные по списаниям, заказам и посещаемости.</p>
            <div className="row"><strong>Заказано:</strong> {rub(summary.plannedRub)}</div>
            <div className="row"><strong>Списано:</strong> {rub(summary.wasteRub)}</div>
          </div>
        </Card>
      </div>
      <Card title="Детализация по блюдам">
        <div className="table-wrap"><table>
          <thead><tr><th>Блюдо</th><th>Тип</th><th>Дней в меню</th><th>Съедают</th><th>Списания</th><th>Сумма</th></tr></thead>
          <tbody>{data.dishes.map((dish) => (
            <tr key={dish.dish_id}><td>{dish.name}</td><td>{CATEGORY_LABELS[dish.category]}</td><td>{dish.days}</td><td>{pct(dish.eatenPct)}</td><td>{pct(dish.wastePct)}</td><td>{rub(dish.wasteRub)}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>
    </>
  );
}
