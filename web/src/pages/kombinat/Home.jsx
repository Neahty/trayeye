import { useApi } from "../../lib/useApi";
import { dayLong, pct, rub } from "../../lib/format";
import { Card, Status } from "../../components/ui.jsx";

export default function KombinatHome() {
  const { data, loading, error } = useApi("/kombinat/dashboard");
  if (!data) return <Status loading={loading} error={error} />;
  const { totals, schools } = data;

  return (
    <>
      <h1>{data.kombinat.name}</h1>
      <p className="muted">Сегодня {dayLong(data.date)}</p>

      <div className="grid3">
        <Card title="Экономия">
          <div className="big">{rub(totals.savingsRub)}</div>
          <div className="muted">За сегодня по {totals.schools} школам</div>
        </Card>
        <Card title="Списано">
          <div className="big">{rub(totals.wasteRub)}</div>
          <div className="muted">За сегодня</div>
        </Card>
        <Card title="Детей">
          <div className="big">{totals.kids.present}/{totals.kids.students}</div>
          <div className="muted">{pct(totals.kids.pct)} пришли</div>
        </Card>
      </div>

      <Card title="Школы сегодня">
        <table>
          <thead><tr><th>Школа</th><th>Директор</th><th>Списания</th><th>Было</th><th>Экономия</th><th>Детей</th><th>Совет</th></tr></thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.director_name || "-"}</td>
                <td>{pct(s.cards.waste.pct)}</td>
                <td>{pct(s.cards.waste.baselinePct)}</td>
                <td>{rub(s.cards.savings.rub)}</td>
                <td>{s.cards.kids.present}/{s.cards.kids.students}</td>
                <td>{s.recommendations[0]?.text || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
