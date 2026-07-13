import { useState } from "react";
import { Admin } from "../api";
import { useFetch, useLive, Stat, Loader, money, fmtDate, fmtDay, subLabel, useTariffMap } from "../lib.jsx";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const axis = { stroke: "#62626F", fontSize: 12 };

// Понятные подписи статусов платежей
const PAY_STATUS = {
  succeeded: "Оплачено", pending: "В ожидании", refunded: "Возврат",
  error: "Ошибка", cancelled: "Отменён", all: "Все"
};
const payLabel = (s) => PAY_STATUS[s] || s;

const YK_PERIODS = { day: "День", week: "Неделя", month: "Месяц", all: "Всё время" };

export default function Finance() {
  const { intervalMs } = useLive();
  const { data, loading } = useFetch(Admin.finance, [], { intervalMs });
  const tariffMap = useTariffMap();
  const [status, setStatus] = useState("succeeded");
  const pays = useFetch(() => Admin.payments({ status }), [status], { intervalMs });
  const [ykPeriod, setYkPeriod] = useState("month");
  const yk = useFetch(() => Admin.financeYukassa({ period: ykPeriod }), [ykPeriod], { intervalMs });

  if (loading) return <Loader />;

  const byDay = (data.by_day || []).map((r) => ({ day: fmtDay(r.day), v: r.amount }));

  return (
    <div>
      <div className="topbar"><h1 className="page-title">Деньги</h1></div>

      <div className="section-title">По данным ЮKassa</div>
      <div className="row" style={{ marginBottom: 12 }}>
        {Object.entries(YK_PERIODS).map(([k, label]) => (
          <button key={k} className={"btn sm " + (ykPeriod === k ? "" : "ghost")} onClick={() => setYkPeriod(k)}>{label}</button>
        ))}
      </div>
      {yk.loading ? <Loader /> : yk.data?.mock ? (
        <div className="muted" style={{ marginBottom: 8 }}>
          Тестовый режим (mock): ключи ЮKassa не заданы, реальных денег нет. Цифры ЮKassa появятся после
          подключения боевого магазина (PAYMENTS_MODE=live).
        </div>
      ) : (
        <>
          <div className="grid cols-4">
            <Stat label="Получено (брутто)" value={money(yk.data?.gross || 0)} />
            <Stat label="Комиссия ЮKassa" value={money(yk.data?.commission || 0)} />
            <Stat label="Чистыми" value={money(yk.data?.net || 0)} />
            <Stat label="Возвраты" value={money(yk.data?.refunds || 0)} />
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Платежей: {yk.data?.count || 0}. Сумма выводов на банковский счёт через API недоступна — смотрите в{" "}
            <a href="https://yookassa.ru/my" target="_blank" rel="noreferrer">личном кабинете ЮKassa</a>.
          </div>
        </>
      )}

      <div className="section-title">По базе данных</div>
      <div className="grid cols-4">
        <Stat label="Заработано всего" value={money(data.total)} />
        <Stat label="Заработано за день" value={money(data.day)} />
        <Stat label="Заработано за неделю" value={money(data.week)} />
        <Stat label="Заработано за месяц" value={money(data.month)} />
      </div>

      <div className="grid cols-2" style={{ marginTop: 20 }}>
        <div className="chart-card">
          <div style={{ fontWeight: 800, marginBottom: 14 }}>Сколько денег приходит по дням</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byDay}>
              <CartesianGrid stroke="#2a2a36" vertical={false} />
              <XAxis dataKey="day" {...axis} /><YAxis {...axis} />
              <Tooltip contentStyle={{ background: "#1A1A22", border: "1px solid #333" }} />
              <Bar dataKey="v" name="₽" fill="#22C55E" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card">
          <div style={{ fontWeight: 800, marginBottom: 14 }}>Сколько денег по тарифам</div>
          {(data.by_tariff || []).map((t) => (
            <div className="kv" key={t.tariff}>
              <span>{subLabel(t.tariff, tariffMap)} · {t.count} шт</span><span>{money(t.amount)}</span>
            </div>
          ))}
          {!data.by_tariff?.length && <div className="muted">Пока нет данных</div>}
        </div>
      </div>

      <div className="section-title">Платежи</div>
      <div className="row" style={{ marginBottom: 12 }}>
        {["succeeded", "pending", "refunded", "error", "cancelled", "all"].map((s) => (
          <button key={s} className={"btn sm " + (status === s ? "" : "ghost")} onClick={() => setStatus(s)}>{payLabel(s)}</button>
        ))}
      </div>
      {pays.loading ? <Loader /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Дата</th><th>Пользователь</th><th>Сумма</th><th>Тариф</th><th>Способ оплаты</th><th>Статус</th></tr></thead>
            <tbody>
              {pays.data.payments.map((p) => (
                <tr key={p.id}>
                  <td data-label="Дата">{fmtDate(p.created_at)}</td>
                  <td data-label="Пользователь">{p.username || p.telegram_id}</td>
                  <td data-label="Сумма">{money(p.amount)}</td>
                  <td data-label="Тариф">{p.sub_type ? subLabel(p.sub_type, tariffMap) : "—"}</td>
                  <td data-label="Способ оплаты">{p.method || "—"}</td>
                  <td data-label="Статус"><span className={"pill " + (p.status === "succeeded" ? "green" : p.status === "error" ? "red" : "")}>{payLabel(p.status)}</span></td>
                </tr>
              ))}
              {!pays.data.payments.length && <tr><td colSpan={6} className="muted" style={{ textAlign: "center" }}>Платежей нет</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
