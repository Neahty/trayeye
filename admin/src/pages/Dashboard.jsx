import { Admin } from "../api";
import { useFetch, useLive, Stat, Loader, money, fmtDay } from "../lib.jsx";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const axis = { stroke: "#62626F", fontSize: 12 };
const grid = "#2a2a36";

function Chart({ title, children }) {
  return (
    <div className="chart-card">
      <div style={{ fontWeight: 800, marginBottom: 14 }}>{title}</div>
      <ResponsiveContainer width="100%" height={220}>{children}</ResponsiveContainer>
    </div>
  );
}

export default function Dashboard() {
  const { intervalMs } = useLive();
  const { data, loading, error } = useFetch(Admin.dashboard, [], { intervalMs });
  if (loading) return <Loader />;
  if (error) return <div className="err">{error}</div>;

  const c = data.charts || {};
  const map = (arr, key) => (arr || []).map((r) => ({ day: fmtDay(r.day), v: Number(r[key]) || 0 }));

  return (
    <div>
      <div className="topbar"><h1 className="page-title">Главная</h1></div>

      <div className="grid cols-4">
        <Stat label="Активные пользователи" value={data.active_users ?? data.total_users} />
        <Stat label="Неактивные (отписались / в ЧС)" value={data.inactive_users ?? 0} />
        <Stat label="Новых за сегодня" value={data.new_today} />
        <Stat label="Заходили за сутки" value={data.dau} />
        <Stat label="Заходили за месяц" value={data.mau} />
        <Stat label="Доля платящих" value={data.conversion_percent + "%"} />
        <Stat label="Действующих подписок" value={data.active_subscribers} />
        <Stat label="Заработано за сегодня" value={money(data.revenue_today)} />
        <Stat label="Заработано за месяц" value={money(data.revenue_month)} />
        {data.gpt_balance_rub != null && (
          <Stat label="Баланс GPT API" value={money(data.gpt_balance_rub)}
            sub={data.gpt_balance_age_days > 14
              ? `баланс вводили ${data.gpt_balance_age_days} дн. назад — обновите в настройках`
              : (data.gpt_balance_is_real ? "осталось (данные OpenAI)" : "осталось (оценка)")} />
        )}
      </div>

      <div className="grid cols-2" style={{ marginTop: 20 }}>
        <Chart title="Сколько прибавляется пользователей">
          <AreaChart data={map(c.user_growth, "count")}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey="day" {...axis} /><YAxis {...axis} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#1A1A22", border: "1px solid #333" }} />
            <Area dataKey="v" name="Новых" stroke="#7C3AED" fill="#7C3AED55" />
          </AreaChart>
        </Chart>
        <Chart title="Сколько денег приходит по дням">
          <AreaChart data={map(c.revenue_growth, "amount")}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey="day" {...axis} /><YAxis {...axis} />
            <Tooltip contentStyle={{ background: "#1A1A22", border: "1px solid #333" }} />
            <Area dataKey="v" name="₽" stroke="#22C55E" fill="#22C55E55" />
          </AreaChart>
        </Chart>
        <Chart title="Сколько людей заходит каждый день">
          <LineChart data={map(c.activity, "users")}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey="day" {...axis} /><YAxis {...axis} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#1A1A22", border: "1px solid #333" }} />
            <Line dataKey="v" name="Заходили" stroke="#3B82F6" dot={false} strokeWidth={2} />
          </LineChart>
        </Chart>
        <Chart title="Сколько фото еды распознано">
          <BarChart data={map(c.scans, "count")}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey="day" {...axis} /><YAxis {...axis} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#1A1A22", border: "1px solid #333" }} />
            <Bar dataKey="v" name="Распознано" fill="#F59E0B" radius={[5, 5, 0, 0]} />
          </BarChart>
        </Chart>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Stat label="Распознано фото еды за сутки" value={data.scans_today} />
      </div>
    </div>
  );
}
