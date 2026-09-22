import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Employees } from "../api";
import { useFetch, useLive, Stat, Loader, money, fmtDate, fmtDay } from "../lib.jsx";
import { AvatarDot, CopyButton } from "./Employees.jsx";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const axis = { stroke: "#62626F", fontSize: 12 };
const grid = "#2a2a36";

const REF_STATUS = {
  pending: { label: "на проверке", cls: "amber" },
  confirmed: { label: "засчитан", cls: "green" },
  rejected: { label: "отклонён", cls: "red" }
};

const REJECT_REASONS = {
  app_not_opened: "не открыл приложение",
  left_channel: "вышел из канала",
  blocked_bot: "заблокировал бота"
};

function Chart({ title, children }) {
  return (
    <div className="chart-card">
      <div style={{ fontWeight: 800, marginBottom: 14 }}>{title}</div>
      <ResponsiveContainer width="100%" height={220}>{children}</ResponsiveContainer>
    </div>
  );
}

// Модалка выплаты: тип (за людей / за подписки) → сколько не выплачено → ставка за
// единицу → итог = кол-во × ставка. Выплата закрывает всё невыплаченное типа.
function PayoutModal({ stats, busy, onPay, onClose }) {
  const [kind, setKind] = useState("referrals");
  const [rate, setRate] = useState("");
  const count = kind === "referrals" ? stats.referrals.unpaid : stats.payments.unpaid;
  const rateNum = Math.round(Number(rate)) || 0;
  const total = count * rateNum;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>💰 Отметить выплату</h2>

        <div className="field">
          <label>За что платим</label>
          <div className="row">
            <button className={"btn" + (kind === "referrals" ? "" : " ghost")} style={{ flex: 1 }}
              onClick={() => setKind("referrals")}>
              👥 За людей
              <div style={{ fontSize: 12, fontWeight: 600, opacity: .85 }}>не выплачено: {stats.referrals.unpaid}</div>
            </button>
            <button className={"btn" + (kind === "subscriptions" ? "" : " ghost")} style={{ flex: 1 }}
              onClick={() => setKind("subscriptions")}>
              💳 За подписки
              <div style={{ fontSize: 12, fontWeight: 600, opacity: .85 }}>не выплачено: {stats.payments.unpaid}</div>
            </button>
          </div>
        </div>

        <div className="field">
          <label>{kind === "referrals" ? "Сколько платишь за одного человека, ₽" : "Сколько платишь за одну подписку, ₽"}</label>
          <input className="input" type="number" min="1" autoFocus
            placeholder="например, 50"
            value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>

        <div className="kv" style={{ borderTop: "1px solid var(--border)" }}>
          <span>Единиц к выплате</span><b>{count}</b>
        </div>
        <div className="kv">
          <span>Ставка</span><b>{money(rateNum)}</b>
        </div>
        <div className="kv" style={{ borderBottom: "none" }}>
          <span>Итого к выплате</span>
          <b style={{ fontSize: 18, color: "#7ee2a8" }}>{money(total)}</b>
        </div>

        <p className="muted" style={{ fontSize: 13, margin: "10px 0 16px" }}>
          Деньги ты переводишь сам - здесь только отметка. Выплата закроет всё невыплаченное
          этого типа, бот пришлёт сотруднику сообщение. Ошибся - выплату можно отменить в истории.
        </p>

        <div className="row">
          <button className="btn" disabled={busy || !count || rateNum <= 0} onClick={() => onPay(kind, rateNum)}>
            {busy ? "Сохраняю…" : `Выплатить ${total > 0 ? money(total) : ""}`}
          </button>
          <button className="btn ghost" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

export default function EmployeeCardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { intervalMs } = useLive();
  const { data, loading, error, reload } = useFetch(() => Employees.detail(id), [id], { intervalMs });
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loader />;
  if (error) return <div className="err">{error}</div>;

  const { employee: emp, stats, referrals, payouts, chart } = data;
  const name = emp.name || (emp.username ? "@" + emp.username : String(emp.telegram_id));
  const unpaidTotal = stats.referrals.unpaid + stats.payments.unpaid;

  const pay = async (kind, rate) => {
    if (busy) return;
    setBusy(true);
    try {
      await Employees.payout(emp.id, { kind, rate });
      setPayoutOpen(false);
      reload();
    } catch (ex) {
      const code = ex?.response?.data?.error;
      alert(code === "nothing_to_pay" ? "Нечего выплачивать - всё уже закрыто." : "Не получилось: " + (code || ex.message));
    } finally {
      setBusy(false);
    }
  };

  const cancelPayout = async (p) => {
    if (!window.confirm(`Отменить выплату ${money(p.total)} от ${fmtDate(p.created_at)}?\n\nЕдиницы снова станут невыплаченными, сотрудник получит сообщение об отмене.`)) return;
    try {
      await Employees.cancelPayout(emp.id, p.id);
      reload();
    } catch (ex) {
      alert("Не получилось: " + (ex?.response?.data?.error || ex.message));
    }
  };

  const chartData = (chart || []).map((r) => ({
    day: fmtDay(r.day),
    clicks: Number(r.clicks) || 0,
    referrals: Number(r.referrals) || 0,
    payments: Number(r.payments) || 0
  }));

  return (
    <div>
      <div className="topbar">
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button className="btn ghost sm" onClick={() => navigate("/employees")}>← Работники</button>
          <AvatarDot name={emp.name || emp.username} size={38} />
          <span>
            {name}
            {emp.username && emp.name && <span className="muted" style={{ fontWeight: 600, fontSize: 15 }}> @{emp.username}</span>}
          </span>
          <span className={"pill " + (emp.active ? "green" : "red")}>{emp.active ? "активен" : "отключён"}</span>
        </h1>
        <div className="row">
          <CopyButton text={emp.link} label="🔗 Копировать ссылку" small={false} />
          <button className="btn" onClick={() => setPayoutOpen(true)}>
            💰 Выплатить{unpaidTotal > 0 ? ` (${unpaidTotal})` : ""}
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginTop: -8, marginBottom: 16, wordBreak: "break-all", fontSize: 13 }}>
        Ссылка: <span style={{ color: "var(--text)" }}>{emp.link}</span> · добавлен {fmtDate(emp.created_at)}
        {!emp.active && emp.deactivated_at && <> · отключён {fmtDate(emp.deactivated_at)}</>}
      </p>

      {payoutOpen && <PayoutModal stats={stats} busy={busy} onPay={pay} onClose={() => setPayoutOpen(false)} />}

      <div className="grid cols-4">
        <Stat label="Переходы по ссылке" value={stats.clicks.total} sub={`сегодня: ${stats.clicks.day} · за 30 дней: ${stats.clicks.month}`} />
        <Stat label="Рефералы (засчитаны)" value={stats.referrals.confirmed}
          sub={`на проверке: ${stats.referrals.pending} · отклонено: ${stats.referrals.rejected}`} />
        <Stat label="Оплаты подписок" value={stats.payments.total} sub={`принёс: ${money(stats.payments.revenue)}`} />
        <Stat label="Выплачено сотруднику" value={money(stats.payouts.paid_total)}
          sub={unpaidTotal > 0 ? `⚠ ждут: ${stats.referrals.unpaid} чел. / ${stats.payments.unpaid} подп.` : "невыплаченного нет"} />
      </div>

      <div className="grid cols-2" style={{ marginTop: 20 }}>
        <Chart title="Переходы и рефералы по дням">
          <AreaChart data={chartData}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey="day" {...axis} /><YAxis {...axis} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#1A1A22", border: "1px solid #333" }} />
            <Area dataKey="clicks" name="Переходы" stroke="#3B82F6" fill="#3B82F655" />
            <Area dataKey="referrals" name="Рефералы" stroke="#7C3AED" fill="#7C3AED55" />
          </AreaChart>
        </Chart>
        <Chart title="Оплаты подписок по дням">
          <BarChart data={chartData}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey="day" {...axis} /><YAxis {...axis} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#1A1A22", border: "1px solid #333" }} />
            <Bar dataKey="payments" name="Оплаты" fill="#22C55E" radius={[5, 5, 0, 0]} />
          </BarChart>
        </Chart>
      </div>

      <div className="section-title">История выплат</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Дата</th><th>За что</th><th>Кол-во</th><th>Ставка</th><th>Сумма</th><th>Статус</th><th></th></tr>
          </thead>
          <tbody>
            {(payouts || []).map((p) => (
              <tr key={p.id} style={{ cursor: "default" }}>
                <td data-label="Дата">{fmtDate(p.created_at)}</td>
                <td data-label="За что">{p.kind === "referrals" ? "👥 приведённые люди" : "💳 оплаченные подписки"}</td>
                <td data-label="Кол-во">{p.unit_count}</td>
                <td data-label="Ставка">{money(p.unit_rate)}</td>
                <td data-label="Сумма"><b>{money(p.total)}</b></td>
                <td data-label="Статус">
                  <span className={"pill " + (p.status === "paid" ? "green" : "red")}>
                    {p.status === "paid" ? "выплачено" : "отменено"}
                  </span>
                </td>
                <td>
                  {p.status === "paid" && (
                    <button className="btn ghost sm" onClick={() => cancelPayout(p)}>Отменить</button>
                  )}
                </td>
              </tr>
            ))}
            {!(payouts || []).length && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: "center", cursor: "default" }}>Выплат ещё не было</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="section-title">Рефералы поимённо</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Кто</th><th>Пришёл</th><th>Статус</th><th>Оплат</th><th>Принёс</th><th>Выплачен</th></tr>
          </thead>
          <tbody>
            {(referrals || []).map((r) => {
              const st = REF_STATUS[r.status] || { label: r.status, cls: "" };
              return (
                <tr key={r.id} style={{ cursor: "default" }}>
                  <td data-label="Кто">
                    <span style={{ fontWeight: 700 }}>{r.name || "Без имени"}</span>
                    {r.username && <span className="muted"> @{r.username}</span>}
                  </td>
                  <td data-label="Пришёл">{fmtDate(r.created_at)}</td>
                  <td data-label="Статус">
                    <span className={"pill " + st.cls}>
                      {st.label}{r.reject_reason ? ` - ${REJECT_REASONS[r.reject_reason] || r.reject_reason}` : ""}
                    </span>
                  </td>
                  <td data-label="Оплат">{r.payments_count}</td>
                  <td data-label="Принёс">{r.revenue > 0 ? <b>{money(r.revenue)}</b> : <span className="muted">-</span>}</td>
                  <td data-label="Выплачен">{r.status === "confirmed" ? (r.paid_out ? "✅" : <span className="pill amber">ждёт</span>) : ""}</td>
                </tr>
              );
            })}
            {!(referrals || []).length && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: "center", cursor: "default" }}>По этой ссылке ещё никто не приходил</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
