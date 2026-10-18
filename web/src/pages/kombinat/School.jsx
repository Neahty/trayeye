import { Link, useParams } from "react-router-dom";
import { appUrl, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useDateParam } from "../../lib/hooks";
import { dayLong, isoDate, pct, rub } from "../../lib/format";
import { StatsView } from "../../components/StatsView.jsx";
import { Card, DateInput, DishImage, MetricCard, PlusIcon, Status, ZoneChip } from "../../components/ui.jsx";
import { ForecastDiff } from "../director/Home.jsx";

// Карточка школы для комбината: что сегодня, прогноз на завтра, рекомендации и статистика за период.
export default function KombinatSchool() {
  const { id } = useParams();
  const [from, setFrom] = useDateParam(isoDate(-30), "from");
  const [to, setTo] = useDateParam(isoDate(), "to");
  const { data, loading, error } = useApi(`/kombinat/schools/${encodeURIComponent(id)}${qs({ from, to })}`);

  if (!data) {
    return <>
      <Link className="back-link" to="/kombinat/schools">← Все школы</Link>
      <Status loading={loading} error={error?.status === 404 ? { code: "school_not_found" } : error} />
    </>;
  }
  const { school, cards, forecast, recommendations, stats } = data;

  return <>
    <Link className="back-link" to="/kombinat/schools">← Все школы</Link>
    <div className="page-heading">
      <div>
        <h1>{school.name}</h1>
        <p className="page-subtitle">{school.director_name ? `Директор: ${school.director_name}` : "Директор ещё не приглашён"} · сегодня {dayLong(data.date)}</p>
      </div>
      <Link className="add-link" to={`/kombinat/schools?invite=${school.id}`}><PlusIcon />{school.director_name ? "Новая ссылка директору" : "Пригласить директора"}</Link>
    </div>

    <div className="grid3">
      <MetricCard kind="waste" title="Списания сегодня" value={pct(cards.waste.pct)} badge={<ZoneChip value={cards.waste.pct} />} note={`Было ${pct(cards.waste.baselinePct)}`} noteIcon />
      <MetricCard kind="savings" title="Экономия сегодня" value={rub(cards.savings.rub)} note="За сегодня" />
      <MetricCard kind="kids" title="Детей" value={`${cards.kids.present}/${cards.kids.students}`} note={`${pct(cards.kids.pct)} пришли`} blue />
    </div>

    <div className="grid2">
      <Card title={`Прогноз на ${dayLong(forecast.date)}`} icon="chart" tone="blue">
        <div className="forecast-card">
          {forecast.items.length === 0 && <p className="muted">Меню на этот день ещё нет.</p>}
          <table className="forecast-list"><tbody>
            {forecast.items.map((item) => <tr key={item.dish_id}>
              <td><DishImage src={item.image_url} /></td>
              <td>{item.name}</td>
              <td className="portions">{item.forecast} порций (обычно {item.usual})</td>
              <ForecastDiff diff={item.diff} />
            </tr>)}
          </tbody></table>
        </div>
      </Card>
      <Card title="Рекомендации" icon="bulb" tone="green" className="accent recommend-card">
        {recommendations.length === 0 && <p className="muted">Пока всё хорошо.</p>}
        {recommendations.map((item) => <p key={item.text}>{item.text}</p>)}
        <img className="recommend-art" src={appUrl("/figma/imgRectangle4281.png")} alt="" />
      </Card>
    </div>

    <div className="page-heading">
      <h2>Статистика за период</h2>
      <div className="page-tools">
        <DateInput label="С" value={from} onChange={setFrom} />
        <DateInput label="по" value={to} onChange={setTo} />
      </div>
    </div>
    <StatsView data={stats} from={stats.from} to={stats.to} />
  </>;
}
