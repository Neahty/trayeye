import { useState } from "react";
import { CATEGORY_LABELS, dayLong, dayShort, pct, rub } from "../lib/format";
import { Card, Icon, MetricCard, Toast, shareReport } from "./ui.jsx";

const CHART = { left: 28, right: 672, top: 18, bottom: 202 };

function chartX(i, count) {
  return count > 1 ? CHART.left + i * ((CHART.right - CHART.left) / (count - 1)) : (CHART.left + CHART.right) / 2;
}

// Шкала по данным периода с запасом, чтобы колебания было видно (как в макете).
function chartScale(values) {
  const lo = Math.max(0, Math.min(...values) - 15);
  const hi = Math.min(100, Math.max(...values) + 10);
  const span = Math.max(1, hi - lo);
  return (value) => CHART.bottom - 10 - ((value - lo) / span) * (CHART.bottom - CHART.top - 20);
}

// Линия съедаемости по дням; последняя точка выделена светлой полосой, как в макете.
function EatenChart({ series }) {
  const points = series.filter((item) => item.eatenPct !== null && item.eatenPct !== undefined);
  if (points.length === 0) return <p className="muted">За период ещё нет данных с камеры.</p>;
  const chartY = chartScale(points.map((item) => item.eatenPct));
  const coords = points.map((item, i) => [chartX(i, points.length), chartY(item.eatenPct)]);
  const selected = coords.length - 1;
  const tickStep = Math.max(1, Math.ceil(points.length / 9));

  return (
    <svg className="chart-svg" viewBox="0 0 700 245" role="img" aria-label="График съедаемости по дням">
      <rect className="chart-band" x={coords[selected][0] - 29} y={CHART.top} width="58" height={CHART.bottom - CHART.top} fill="#edfff2" />
      <polyline className="chart-line" pathLength="1" points={coords.map((c) => c.join(",")).join(" ")} />
      <circle className="chart-dot" cx={coords[selected][0]} cy={coords[selected][1]} r="6" fill="white" stroke="#5c6b5f" strokeWidth="1.5" />
      {points.map((item, i) => (i % tickStep === 0 || i === points.length - 1) && (
        <text key={item.date} className="chart-tick" x={coords[i][0]} y="229" textAnchor="middle">{dayShort(item.date)}</text>
      ))}
    </svg>
  );
}

function signed(n) {
  if (n === null || n === undefined) return null;
  return `${n > 0 ? "+" : ""}${n}%`;
}

export function StatsView({ data, from, to, shareLabel = "Отправить в комбинат" }) {
  const [toast, setToast] = useState(null);
  const summary = data.summary || {};
  const eatenChange = summary.eatenPct !== null && summary.baselineEatenPct !== null && summary.baselineEatenPct !== undefined
    ? summary.eatenPct - summary.baselineEatenPct
    : null;
  const period = `${dayLong(from)} - ${dayLong(to)}`;
  const reportText = [
    `Период: ${period}`,
    `Списания: ${pct(summary.wastePct)} (было ${pct(summary.baselinePct)}), ${rub(summary.wasteRub)}`,
    `Экономия: ${rub(summary.savingsRub)}`,
    `Съедаемость: ${pct(summary.eatenPct)}`
  ].join("\n");

  return (
    <>
      <div className="grid3">
        <MetricCard kind="waste" title="Списания" value={pct(summary.wastePct)} note={`Было ${pct(summary.baselinePct)}`} noteIcon />
        <MetricCard kind="savings" title="Экономия" value={rub(summary.savingsRub)} note={`Заказано на ${rub(summary.plannedRub)}`} noteIcon />
        <MetricCard kind="eaten" title="Съедаемость" value={pct(summary.eatenPct)} note={`Было ${pct(summary.baselineEatenPct)}`} noteIcon blue />
      </div>
      <div className="grid2">
        <Card title={<>Статистика съедаемости{signed(eatenChange) && <span className="chart-badge">{signed(eatenChange)}</span>}</>}>
          <div className="chart-card"><EatenChart series={data.series || []} /></div>
        </Card>
        <Card title="Отчёт за период" icon="bulb" tone="green" className="accent report-card">
          <p>Отчёт за {period} готов к отправке и сформирован в одном файле.</p>
          <Toast>{toast}</Toast>
          <div className="report-actions">
            <button onClick={() => window.print()}><Icon name="arrowDown" size={18} />Экспорт в PDF</button>
            <button className="secondary" onClick={async () => setToast(await shareReport("Отчёт TrayEye", reportText))}><Icon name="stats" size={18} />{shareLabel}</button>
          </div>
        </Card>
      </div>
      <Card title="Детализация по блюдам">
        <div className="table-wrap"><table>
          <thead><tr><th>Блюдо</th><th>Тип</th><th className="num">Дней в меню</th><th className="num">Съедают</th><th className="num">Списания</th><th className="num">Сумма</th></tr></thead>
          <tbody>{data.dishes.map((dish) => (
            <tr key={dish.dish_id} data-focus={`dish-${dish.dish_id}`}><td>{dish.name}</td><td>{CATEGORY_LABELS[dish.category]}</td><td className="num">{dish.days}</td><td className="num">{pct(dish.eatenPct)}</td><td className="num">{pct(dish.wastePct)}</td><td className="num">{rub(dish.wasteRub)}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>
    </>
  );
}
