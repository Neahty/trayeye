import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { dayLong, greeting, greetingName, pct, rub } from "../../lib/format";
import { Card, DishImage, Status, errorText } from "../../components/ui.jsx";

export default function DirectorHome() {
  const { data, loading, error, reload } = useApi("/director/dashboard");
  const [applyState, setApplyState] = useState(null);

  if (!data) return <Status loading={loading} error={error} />;
  const { cards, forecast, recommendations } = data;

  const applyForecast = async () => {
    setApplyState("Применяем...");
    try {
      const r = await api.post("/director/forecast/apply");
      setApplyState(`Заказ на ${dayLong(r.date)} обновлён по прогнозу.`);
      reload();
    } catch (e) {
      setApplyState(errorText(e));
    }
  };

  return (
    <>
      <h1>{greeting()}, {greetingName(data.director.fullName)}!</h1>
      <p className="muted">Сегодня {dayLong(data.date)}</p>

      <div className="grid3">
        <Card title="Списания">
          <div className="big">{pct(cards.waste.pct)}</div>
          <div className="muted">Было {pct(cards.waste.baselinePct)} · {rub(cards.waste.rub)}</div>
        </Card>
        <Card title="Экономия">
          <div className="big">{rub(cards.savings.rub)}</div>
          <div className="muted">За сегодня</div>
        </Card>
        <Card title="Детей">
          <div className="big">{cards.kids.present}/{cards.kids.students}</div>
          <div className="muted">{pct(cards.kids.pct)} пришли</div>
        </Card>
      </div>

      <div className="grid2">
        <Card title={`Прогноз на ${dayLong(forecast.date)}`}>
          {forecast.items.length === 0 && <p className="muted">Меню на этот день ещё нет.</p>}
          <table>
            <tbody>
              {forecast.items.map((f) => (
                <tr key={f.dish_id}>
                  <td><DishImage src={f.image_url} /></td>
                  <td>{f.name}</td>
                  <td>{f.forecast} порций (обычно {f.usual})</td>
                  <td className={f.diff > 0 ? "good" : "bad"}>{f.diff > 0 ? `−${f.diff}` : `+${-f.diff}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {forecast.items.length > 0 && <button onClick={applyForecast}>Применить прогноз к заказу</button>}
          {applyState && <p className="muted">{applyState}</p>}
        </Card>

        <Card title="Рекомендации">
          {recommendations.length === 0 && <p className="muted">Пока всё хорошо.</p>}
          <ul>
            {recommendations.map((r) => <li key={r.text}>{r.text}</li>)}
          </ul>
        </Card>
      </div>

      <div className="row">
        <Link className="button" to="/director/stats">Открыть статистику</Link>
        <Link className="button secondary" to="/director/menu">Посмотреть меню</Link>
      </div>
    </>
  );
}
