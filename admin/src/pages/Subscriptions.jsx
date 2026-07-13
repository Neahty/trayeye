import { Admin } from "../api";
import { useFetch, useLive, Loader, fmtDate, subLabel, askGrantBody, useTariffMap } from "../lib.jsx";

const STATUS = { active: "Действует", cancelled: "Отменена", expired: "Закончилась" };

export default function Subscriptions() {
  const { intervalMs } = useLive();
  const { data, loading, reload } = useFetch(Admin.subscriptions, [], { intervalMs });
  const tariffMap = useTariffMap();
  if (loading) return <Loader />;

  const act = async (fn) => { await fn(); reload(); };

  return (
    <div>
      <div className="topbar"><h1 className="page-title">Подписки</h1></div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Пользователь</th><th>Тариф</th><th>Статус</th><th>Куплено</th><th>Действует до</th><th>Способ оплаты</th><th>Действия</th></tr>
          </thead>
          <tbody>
            {data.subscriptions.map((s) => (
              <tr key={s.id}>
                <td data-label="Пользователь">{s.name || s.username || s.telegram_id}</td>
                <td data-label="Тариф"><span className="pill violet">{subLabel(s.type, tariffMap)}</span></td>
                <td data-label="Статус">{s.status === "active" ? <span className="pill green">Действует</span> : <span className="pill">{STATUS[s.status] || s.status}</span>}</td>
                <td data-label="Куплено">{fmtDate(s.started_at)}</td>
                <td data-label="Действует до">{fmtDate(s.expires_at)}</td>
                <td data-label="Способ оплаты">{s.pay_method || s.method || "—"}</td>
                <td data-label="Действия">
                  <div className="row">
                    <button className="btn ghost sm" onClick={() => { const body = askGrantBody(s.type, 30, tariffMap[s.type]?.price); if (body) act(() => Admin.grantSub(s.user_id, body)); }}>Продлить на 30 дней</button>
                    {s.status === "active" && <button className="btn ghost sm" onClick={() => act(() => Admin.revokeSub(s.user_id))}>Отменить</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!data.subscriptions.length && <tr><td colSpan={7} className="muted" style={{ textAlign: "center" }}>Подписок нет</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
