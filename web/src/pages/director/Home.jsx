import { useState } from "react";
import { Link } from "react-router-dom";
import { api, appUrl } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { dayLong, greeting, greetingName, pct, rub } from "../../lib/format";
import { Card, DishImage, MetricCard, Status, errorText } from "../../components/ui.jsx";

export default function DirectorHome() {
  const { data, loading, error, reload } = useApi("/director/dashboard");
  const [applyState, setApplyState] = useState(null);
  if (!data) return <Status loading={loading} error={error} />;
  const { cards, forecast, recommendations } = data;

  const applyForecast = async () => {
    setApplyState("Применяем...");
    try {
      const result = await api.post("/director/forecast/apply");
      setApplyState(`Заказ на ${dayLong(result.date)} обновлён по прогнозу.`);
      reload();
    } catch (e) { setApplyState(errorText(e)); }
  };

  return <>
    <div><h1>{greeting()}, {greetingName(data.director.fullName)}!</h1><p className="page-subtitle">Сегодня {dayLong(data.date)}</p></div>
    <div className="grid3">
      <MetricCard kind="waste" title="Списания" value={pct(cards.waste.pct)} note={`Было ${pct(cards.waste.baselinePct)} · ${rub(cards.waste.rub)}`} />
      <MetricCard kind="savings" title="Экономия" value={rub(cards.savings.rub)} note="За сегодня" />
      <MetricCard kind="kids" title="Детей" value={`${cards.kids.present}/${cards.kids.students}`} note={`${pct(cards.kids.pct)} пришли`} blue />
    </div>
    <div className="grid2">
      <Card title={`▮　Прогноз на ${dayLong(forecast.date)}`}>
        <div className="forecast-card">
          {forecast.items.length === 0 && <p className="muted">Меню на этот день ещё нет.</p>}
          <table className="forecast-table"><tbody>
            {forecast.items.map((item) => <tr key={item.dish_id}>
              <td><DishImage src={item.image_url} /></td><td>{item.name}</td>
              <td>{item.forecast} порций <span className="muted">(обычно {item.usual})</span></td>
              <td className={item.diff > 0 ? "good" : "bad"}>{item.diff > 0 ? `−${item.diff}` : `+${-item.diff}`} ↗</td>
            </tr>)}
          </tbody></table>
          {forecast.items.length > 0 && <button onClick={applyForecast}>Применить прогноз к заказу</button>}
          {applyState && <p className="toast">{applyState}</p>}
        </div>
      </Card>
      <Card title="✦　Рекомендации">
        <div className="recommend-card">
          {recommendations.length === 0 && <p className="muted">Пока всё хорошо.</p>}
          <ul>{recommendations.map((item) => <li key={item.text}>{item.text}</li>)}</ul>
          <img className="recommend-art" src={appUrl("/figma/imgRectangle4281.png")} alt="" />
        </div>
      </Card>
    </div>
    <div className="home-actions">
      <Link className="button" to="/director/stats">◩　Открыть статистику</Link>
      <Link className="button secondary" to="/director/menu">◧　Посмотреть меню</Link>
    </div>
  </>;
}
