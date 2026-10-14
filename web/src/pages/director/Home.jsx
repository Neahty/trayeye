import { useState } from "react";
import { Link } from "react-router-dom";
import { api, appUrl } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { dayLong, greeting, greetingName, pct, rub } from "../../lib/format";
import { Card, DishImage, Icon, MetricCard, Status, Toast, errorText } from "../../components/ui.jsx";

// Разница прогноза с обычным заказом: зелёная - можно заказать меньше, красная - нужно больше.
export function ForecastDiff({ diff }) {
  return (
    <td className={`diff ${diff >= 0 ? "good" : "bad"}`}>
      <span className="diff-inner">{Math.abs(diff)}<Icon name="arrowDownRight" size={16} /></span>
    </td>
  );
}

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
      <MetricCard kind="waste" title="Списания" value={pct(cards.waste.pct)} note={`Было ${pct(cards.waste.baselinePct)}`} noteIcon />
      <MetricCard kind="savings" title="Экономия" value={rub(cards.savings.rub)} note="За сегодня" />
      <MetricCard kind="kids" title="Детей" value={`${cards.kids.present}/${cards.kids.students}`} note={`${pct(cards.kids.pct)} пришли`} blue />
    </div>
    <div className="grid2">
      <div className="stack">
        <Card
          title={`Прогноз на ${dayLong(forecast.date)}`}
          icon="chart"
          tone="blue"
          aside={forecast.items.length > 0 && <button className="link" onClick={applyForecast} disabled={applyState === "Применяем..."}>Применить к заказу</button>}
        >
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
            <Toast>{applyState}</Toast>
          </div>
        </Card>
        <div className="home-actions">
          <Link className="button big" to="/director/stats"><Icon name="stats" size={22} />Открыть статистику</Link>
          <Link className="button big secondary" to="/director/menu"><Icon name="book" size={22} />Посмотреть меню</Link>
        </div>
      </div>
      <Card title="Рекомендации" icon="bulb" tone="green" className="accent recommend-card">
        {recommendations.length === 0 && <p className="muted">Пока всё хорошо.</p>}
        {recommendations.map((item) => <p key={item.text}>{item.text}</p>)}
        <img className="recommend-art" src={appUrl("/figma/imgRectangle4281.png")} alt="" />
      </Card>
    </div>
  </>;
}
