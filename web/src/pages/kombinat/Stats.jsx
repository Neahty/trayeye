import { useState } from "react";
import { qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { isoDate, pct, rub } from "../../lib/format";
import { StatsView } from "../../components/StatsView.jsx";
import { DateInput, Status, Card } from "../../components/ui.jsx";

export default function KombinatStats() {
  const [from, setFrom] = useState(isoDate(-30));
  const [to, setTo] = useState(isoDate());
  const { data, loading, error } = useApi(`/kombinat/stats${qs({ from, to })}`);
  return <>
    <div className="page-heading"><h1>Статистика</h1><div className="page-tools">
      <DateInput label="С" value={from} onChange={setFrom} /><DateInput label="по" value={to} onChange={setTo} />
    </div></div>
    <Status loading={loading && !data} error={error} />
    {data && <>
      <StatsView data={data} from={from} to={to} />
      <Card title="Статистика по школам"><div className="table-wrap"><table>
        <thead><tr><th>Школа</th><th>Заказано</th><th>Списано</th><th>Списания</th></tr></thead>
        <tbody>{data.schools.map((school) => <tr key={school.id}><td>{school.name}</td><td>{rub(school.plannedRub)}</td><td>{rub(school.wasteRub)}</td><td>{pct(school.wastePct)}</td></tr>)}</tbody>
      </table></div></Card>
    </>}
  </>;
}
