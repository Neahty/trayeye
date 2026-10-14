import { Link } from "react-router-dom";
import { appUrl } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { dayLong, greeting, pct, rub } from "../../lib/format";
import { Card, Icon, MetricCard, Status } from "../../components/ui.jsx";
import { ForecastDiff } from "../director/Home.jsx";

// Прогноз комбината - сумма прогнозов по блюдам каждой школы.
function schoolForecast(school) {
  const items = school.forecast?.items || [];
  const forecast = items.reduce((a, i) => a + i.forecast, 0);
  const usual = items.reduce((a, i) => a + i.usual, 0);
  return { forecast, usual, diff: usual - forecast, empty: items.length === 0 };
}

export default function KombinatHome() {
  const { data, loading, error } = useApi("/kombinat/dashboard");
  if (!data) return <Status loading={loading} error={error} />;
  const { totals, schools } = data;
  const alerts = schools.flatMap((school) => school.recommendations.map((recommendation) => ({ school, recommendation })));
  const forecastDate = schools[0]?.forecast?.date;

  return <>
    <div><h1>{greeting()}, коллеги!</h1><p className="page-subtitle">Сегодня {dayLong(data.date)}</p></div>
    <div className="grid3">
      <MetricCard kind="waste" title="Списания" value={pct(totals.wastePct)} note={`Было ${pct(totals.baselinePct)}`} noteIcon />
      <MetricCard kind="savings" title="Экономия" value={rub(totals.savingsRub)} note="За сегодня" />
      <MetricCard kind="kids" title="Детей" value={`${totals.kids.present}/${totals.kids.students}`} note={`${pct(totals.kids.pct)} пришли`} blue />
    </div>
    <div className="grid2">
      <div className="stack">
        <Card title={forecastDate ? `Прогноз на ${dayLong(forecastDate)}` : "Прогноз на завтра"} icon="chart" tone="blue">
          <div className="forecast-card">
            {schools.length === 0 && <p className="muted">Подключённых школ пока нет.</p>}
            <table className="forecast-list"><tbody>
              {schools.map((school) => {
                const f = schoolForecast(school);
                return <tr key={school.id}>
                  <td colSpan={2}>{school.name}</td>
                  <td className="portions">{f.empty ? <span className="muted">меню ещё нет</span> : `${f.forecast} порций (обычно ${f.usual})`}</td>
                  {f.empty ? <td /> : <ForecastDiff diff={f.diff} />}
                </tr>;
              })}
            </tbody></table>
          </div>
        </Card>
        <div className="home-actions">
          <Link className="button big" to="/kombinat/stats"><Icon name="stats" size={22} />Открыть статистику</Link>
          <Link className="button big secondary" to="/kombinat/products"><Icon name="book" size={22} />Посмотреть меню</Link>
        </div>
      </div>
      <Card title="Рекомендации" icon="bulb" tone="green" className="accent recommend-card">
        {alerts.length === 0 && <p className="muted">Пока всё хорошо.</p>}
        {alerts.slice(0, 3).map(({ school, recommendation }) => <p key={`${school.id}-${recommendation.text}`}><strong>{school.name}:</strong> {recommendation.text}</p>)}
        <img className="recommend-art" src={appUrl("/figma/imgRectangle4281.png")} alt="" />
      </Card>
    </div>
  </>;
}
