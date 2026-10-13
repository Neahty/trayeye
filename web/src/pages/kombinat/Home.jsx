import { Link } from "react-router-dom";
import { useApi } from "../../lib/useApi";
import { dayLong, greeting, pct, rub } from "../../lib/format";
import { Card, MetricCard, Status } from "../../components/ui.jsx";

export default function KombinatHome() {
  const { data, loading, error } = useApi("/kombinat/dashboard");
  if (!data) return <Status loading={loading} error={error} />;
  const { totals, schools } = data;
  const alerts = schools.flatMap((school) => school.recommendations.map((recommendation) => ({ school, recommendation })));

  return <>
    <div><h1>{greeting()}, коллеги!</h1><p className="page-subtitle">Сегодня {dayLong(data.date)}</p></div>
    <div className="grid3">
      <MetricCard kind="waste" title="Списания" value={rub(totals.wasteRub)} note="Списано за сегодня" />
      <MetricCard kind="savings" title="Экономия" value={rub(totals.savingsRub)} note={`За сегодня · ${totals.schools} школ`} />
      <MetricCard kind="kids" title="Детей" value={`${totals.kids.present}/${totals.kids.students}`} note={`${pct(totals.kids.pct)} пришли`} blue />
    </div>
    <div className="grid2">
      <Card title="▮　Сводка по школам">
        {schools.length === 0 && <p className="muted">Подключённых школ пока нет.</p>}
        <table className="forecast-table"><tbody>
          {schools.map((school) => <tr key={school.id}>
            <td><span className="school-dot" /></td><td>{school.name}</td>
            <td>{rub(school.cards.savings.rub)} <span className="muted">экономия</span></td>
            <td className={school.cards.waste.pct > 15 ? "bad" : "good"}>{pct(school.cards.waste.pct)} ↗</td>
          </tr>)}
        </tbody></table>
      </Card>
      <Card title="✦　Рекомендации">
        <div className="recommend-card">
          {alerts.length ? alerts.slice(0, 3).map(({ school, recommendation }) => <p key={`${school.id}-${recommendation.text}`}><strong>{school.name}:</strong> {recommendation.text}</p>) : <p className="muted">Пока всё хорошо.</p>}
          <img className="recommend-art" src="/figma/imgRectangle4281.png" alt="" />
        </div>
      </Card>
    </div>
    <div className="home-actions">
      <Link className="button" to="/kombinat/stats">◩　Открыть статистику</Link>
      <Link className="button secondary" to="/kombinat/products">◧　Посмотреть меню товаров</Link>
    </div>
  </>;
}
