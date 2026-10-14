import { useState } from "react";
import { qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { isoDate } from "../../lib/format";
import { StatsView } from "../../components/StatsView.jsx";
import { DateInput, Status } from "../../components/ui.jsx";

export default function DirectorStats() {
  const [from, setFrom] = useState(isoDate(-30));
  const [to, setTo] = useState(isoDate());
  const { data, loading, error } = useApi(`/director/stats${qs({ from, to })}`);

  return (
    <>
      <div className="page-heading"><h1>Статистика</h1>
      <div className="page-tools">
        <DateInput label="С" value={from} onChange={setFrom} />
        <DateInput label="по" value={to} onChange={setTo} />
      </div></div>
      <Status loading={loading && !data} error={error} />
      {data && <StatsView data={data} from={from} to={to} />}
    </>
  );
}
