import { Admin } from "../api";
import { useFetch, Stat, Loader, fmtDay } from "../lib.jsx";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const axis = { stroke: "#62626F", fontSize: 12 };
const rub = (n) => (Number(n) || 0).toLocaleString("ru-RU") + " ₽";

export default function AIAnalytics() {
  const { data, loading } = useFetch(Admin.ai, []);
  if (loading) return <Loader />;

  const byDay = (data.chart || []).map((r) => ({ day: fmtDay(r.day), Расход: Number(r.cost_rub) || 0 }));
  const seconds = ((data.avg_latency_ms || 0) / 1000).toFixed(1);

  return (
    <div>
      <div className="topbar"><h1 className="page-title">Расходы на ИИ</h1></div>

      <div className="muted" style={{ marginTop: -6, marginBottom: 14, fontSize: 13 }}>
        {data.is_real
          ? `Суммы — реальные расходы из OpenAI, пересчитаны в рубли по курсу ЦБ РФ (${data.usd_rub} ₽ за $1).`
          : `OpenAI admin-ключ не задан — показана примерная оценка по объёму запросов. Курс ЦБ РФ: ${data.usd_rub} ₽ за $1.`}
      </div>

      <div className="grid cols-4">
        <Stat label="Потрачено всего" value={rub(data.spent_total_rub)} />
        <Stat label="Потрачено сегодня" value={rub(data.spent_today_rub)} sub={data.requests_today + " обращений за сегодня"} />
        <Stat label="Всего обращений к ИИ" value={(data.requests || 0).toLocaleString("ru-RU")} />
        <Stat label="Среднее время ответа" value={seconds + " сек"} />
        <Stat label="Ошибок при обработке" value={data.errors} />
        <Stat label="Курс доллара (ЦБ РФ)" value={data.usd_rub + " ₽"} />
      </div>

      <div className="chart-card" style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 800, marginBottom: 14 }}>Сколько тратится на ИИ по дням (₽)</div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={byDay}>
            <CartesianGrid stroke="#2a2a36" vertical={false} />
            <XAxis dataKey="day" {...axis} /><YAxis {...axis} />
            <Tooltip contentStyle={{ background: "#1A1A22", border: "1px solid #333" }} formatter={(v) => rub(v)} />
            <Area dataKey="Расход" stroke="#7C3AED" fill="#7C3AED55" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="section-title">Кто больше всего пользуется ИИ</div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Пользователь</th><th>Обращений</th><th>Объём (токенов)</th><th>Расход</th></tr></thead>
          <tbody>
            {data.top_users.map((u) => (
              <tr key={u.user_id}>
                <td data-label="Пользователь">{u.username || u.telegram_id}</td>
                <td data-label="Обращений">{u.requests}</td>
                <td data-label="Объём (токенов)">{(u.tokens || 0).toLocaleString("ru-RU")}</td>
                <td data-label="Расход">{rub(u.cost_rub)}</td>
              </tr>
            ))}
            {!data.top_users.length && <tr><td colSpan={4} className="muted" style={{ textAlign: "center" }}>Пока нет данных</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
