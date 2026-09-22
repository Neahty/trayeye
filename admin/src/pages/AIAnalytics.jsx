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
  const providers = data.providers || [];
  const accuracy = data.accuracy || [];

  return (
    <div>
      <div className="topbar"><h1 className="page-title">Расходы на ИИ</h1></div>

      <div className="muted" style={{ marginTop: -6, marginBottom: 14, fontSize: 13 }}>
        {data.is_real
          ? `Суммы - реальные расходы из OpenAI, пересчитаны в рубли по курсу ЦБ РФ (${data.usd_rub} ₽ за $1).`
          : `OpenAI admin-ключ не задан - показана примерная оценка по объёму запросов. Курс ЦБ РФ: ${data.usd_rub} ₽ за $1.`}
        {" "}Расход за сегодня - всегда оценка по токенам: OpenAI отдаёт факт за текущие сутки с задержкой.
      </div>

      <div className="grid cols-4">
        <Stat label="Потрачено за всё время" value={rub(data.spent_total_rub)} />
        <Stat label="Потрачено сегодня" value={rub(data.spent_today_rub)}
          sub={`оценка · ${data.requests_today} обращений за сегодня`} />
        <Stat label="Сэкономил бесплатный Gemini" value={rub(data.saved_rub)} sub="за 30 дней, если бы считал ChatGPT" />
        <Stat label="Всего обращений к ИИ" value={(data.requests || 0).toLocaleString("ru-RU")} />
        <Stat label="Среднее время ответа" value={seconds + " сек"} />
        <Stat label="Ошибок при обработке" value={data.errors} />
        <Stat label="Курс доллара (ЦБ РФ)" value={data.usd_rub + " ₽"} />
      </div>

      <div className="section-title">Кто считает еду (за 30 дней)</div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Провайдер</th><th>Обращений</th><th>Доля</th><th>Ответ</th><th>Расход</th></tr></thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.provider}>
                <td data-label="Провайдер">{p.title}</td>
                <td data-label="Обращений">{(p.requests || 0).toLocaleString("ru-RU")}</td>
                <td data-label="Доля">{p.share_percent}%</td>
                <td data-label="Ответ">{((p.avg_latency_ms || 0) / 1000).toFixed(1)} сек</td>
                <td data-label="Расход">{rub(p.cost_rub)}</td>
              </tr>
            ))}
            {!providers.length && <tr><td colSpan={5} className="muted" style={{ textAlign: "center" }}>Пока нет данных</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="section-title">Как часто люди переделывают за ИИ (за 30 дней)</div>
      <div className="muted" style={{ marginTop: -8, marginBottom: 10, fontSize: 13 }}>
        Чем ниже доля переделок, тем точнее считает ИИ. Резкий рост после смены модели - повод откатиться.
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Способ</th><th>Сканов</th><th>Поправили</th><th>Удалили</th><th>Доля переделок</th></tr></thead>
          <tbody>
            {accuracy.map((a) => (
              <tr key={a.source}>
                <td data-label="Способ">{a.title}</td>
                <td data-label="Сканов">{(a.scans || 0).toLocaleString("ru-RU")}</td>
                <td data-label="Поправили">{a.edits}</td>
                <td data-label="Удалили">{a.deletes}</td>
                <td data-label="Доля переделок">{a.redo_percent}%</td>
              </tr>
            ))}
            {!accuracy.length && <tr><td colSpan={5} className="muted" style={{ textAlign: "center" }}>Пока нет данных</td></tr>}
          </tbody>
        </table>
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
