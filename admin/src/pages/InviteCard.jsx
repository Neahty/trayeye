import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Invites, Admin } from "../api";
import { useFetch, useLive, Stat, Loader, fmtDate, fmtDay, useTariffMap, askGrantBody, GRANT_PERIODS } from "../lib.jsx";
import { AvatarDot, CopyButton } from "./Employees.jsx";
import { INVITE_STATUS, REJECT_REASONS, personName } from "./Invites.jsx";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

// Карточка приглашающего: его ссылка, цифры, динамика за 30 дней и все приведённые
// поимённо. Отсюда же выдаётся награда конкурса — той же ручной выдачей подписки,
// что и в разделе «Пользователи» (никакой автоматики начисления в механике нет).

const axis = { stroke: "#62626F", fontSize: 12 };
const grid = "#2a2a36";

export default function InviteCardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { intervalMs } = useLive();
  const { data, loading, error, reload } = useFetch(() => Invites.detail(id), [id], { intervalMs });
  const tariffMap = useTariffMap();
  const [grantDays, setGrantDays] = useState(30);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loader />;
  if (error) return <div className="err">{error}</div>;

  const { user, stats, invites, chart } = data;

  const grant = async () => {
    if (busy) return;
    const body = askGrantBody("basic", grantDays, tariffMap.basic?.price);
    if (!body) return;
    setBusy(true);
    try {
      await Admin.grantSub(user.id, body);
      reload();
    } catch (ex) {
      alert("Не получилось: " + (ex?.response?.data?.error || ex.message));
    } finally {
      setBusy(false);
    }
  };

  const chartData = (chart || []).map((r) => ({
    day: fmtDay(r.day),
    clicks: Number(r.clicks) || 0,
    invites: Number(r.invites) || 0
  }));

  return (
    <div>
      <div className="topbar">
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button className="btn ghost sm" onClick={() => navigate("/invites")}>← Приглашения</button>
          <AvatarDot name={user.name || user.username} size={38} />
          <span>
            {personName(user)}
            {user.username && user.name && <span className="muted" style={{ fontWeight: 600, fontSize: 15 }}> @{user.username}</span>}
          </span>
        </h1>
        <div className="row">
          {user.link && <CopyButton text={user.link} label="🔗 Копировать ссылку" small={false} />}
        </div>
      </div>

      <p className="muted" style={{ marginTop: -8, marginBottom: 16, wordBreak: "break-all", fontSize: 13 }}>
        {user.link
          ? <>Ссылка: <span style={{ color: "var(--text)" }}>{user.link}</span></>
          : "Ссылку ещё не запрашивал — код выдастся, когда он откроет «Пригласить друга»."}
        {" · "}в боте с {fmtDate(user.created_at)} · id {user.telegram_id}
      </p>

      <div className="grid cols-4">
        <Stat label="Друзей засчитано" value={stats.invites.confirmed}
          sub={`на проверке: ${stats.invites.pending} · отклонено: ${stats.invites.rejected}`} />
        <Stat label="Всего приглашений" value={stats.invites.total}
          sub={`за 30 дней: ${stats.invites.month}`} />
        <Stat label="Переходы по ссылке" value={stats.clicks.total}
          sub={`сегодня: ${stats.clicks.day} · за 30 дней: ${stats.clicks.month}`} />
        <Stat label="Конверсия перехода" value={stats.clicks.total ? Math.round((stats.invites.total / stats.clicks.total) * 100) + "%" : "—"}
          sub="сколько переходов стали приглашениями" />
      </div>

      {/* Награда конкурса: та же ручная выдача подписки, что в разделе «Пользователи». */}
      <div className="section-title">Награда за конкурс</div>
      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {GRANT_PERIODS.map((p) => (
              <button key={p.days} type="button" className={"btn sm " + (grantDays === p.days ? "" : "ghost")}
                disabled={busy} onClick={() => setGrantDays(p.days)}>{p.label}</button>
            ))}
          </div>
          <button className="btn sm" disabled={busy} onClick={grant}>
            {busy ? "Выдаю…" : "🎁 Выдать PRO"}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
          Выдаёт подписку PRO выбранным сроком — то же, что кнопка «Выдать» в карточке пользователя.
          Срок считается от текущего момента, прежняя активная подписка гасится.
        </p>
      </div>

      <div className="chart-card" style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 800, marginBottom: 14 }}>Переходы и приглашения по дням</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey="day" {...axis} /><YAxis {...axis} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#1A1A22", border: "1px solid #333" }} />
            <Area dataKey="clicks" name="Переходы" stroke="#3B82F6" fill="#3B82F655" />
            <Area dataKey="invites" name="Приглашения" stroke="#7C3AED" fill="#7C3AED55" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="section-title">Кого пригласил</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Кто</th><th>Пришёл</th><th>Статус</th><th>Решение</th><th>Условия</th><th>Купил PRO</th></tr>
          </thead>
          <tbody>
            {(invites || []).map((r) => {
              const st = INVITE_STATUS[r.status] || { label: r.status, cls: "" };
              return (
                <tr key={r.id} style={{ cursor: "default" }}>
                  <td data-label="Кто">
                    <span style={{ fontWeight: 700 }}>{r.name || "Без имени"}</span>
                    {r.username && <span className="muted"> @{r.username}</span>}
                    <div className="muted" style={{ fontSize: 12 }}>id {r.telegram_id}</div>
                  </td>
                  <td data-label="Пришёл">{fmtDate(r.created_at)}</td>
                  <td data-label="Статус">
                    <span className={"pill " + st.cls}>
                      {st.label}{r.reject_reason ? ` — ${REJECT_REASONS[r.reject_reason] || r.reject_reason}` : ""}
                    </span>
                  </td>
                  <td data-label="Решение">{r.decided_at ? fmtDate(r.decided_at) : <span className="muted">через 24 ч</span>}</td>
                  <td data-label="Условия" className="muted" style={{ fontSize: 12.5 }}>
                    {r.app_opened ? "открыл приложение" : "не открыл приложение"}
                    {" · "}{r.channel_member ? "в канале" : "не в канале"}
                    {r.tg_unreachable ? " · заблокировал бота" : ""}
                  </td>
                  <td data-label="Купил PRO">{r.user_paid ? "✅" : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
            {!(invites || []).length && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: "center", cursor: "default" }}>
                По его ссылке ещё никто не приходил
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
