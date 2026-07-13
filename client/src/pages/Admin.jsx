import { useEffect, useState } from "react";
import { Admin } from "../api";

export default function AdminPage() {
  const [tab, setTab] = useState("dashboard");
  const [dash, setDash] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [logs, setLogs] = useState([]);

  async function loadDash() { setDash(await Admin.dashboard()); }
  async function loadUsers() { const d = await Admin.users({ search, limit: 50 }); setUsers(d.users); }
  async function loadLogs() { const d = await Admin.logs({}); setLogs(d.logs); }

  useEffect(() => {
    if (tab === "dashboard") loadDash();
    if (tab === "users") loadUsers();
    if (tab === "logs") loadLogs();
  }, [tab]);

  return (
    <div>
      <h1 className="page-title">Админка</h1>
      <div className="tabs">
        <button className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}>Дашборд</button>
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Юзеры</button>
        <button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>Логи</button>
      </div>

      {tab === "dashboard" && dash && (
        <div>
          <div className="card"><div className="muted">Всего пользователей</div><div className="ring-value">{dash.total_users}</div></div>
          <div className="card"><div className="muted">Активных подписок</div><div className="ring-value">{dash.active_subscribers}</div></div>
          <div className="card"><div className="muted">Выручка за месяц</div><div className="ring-value">{dash.revenue_month} ₽</div></div>
          <div className="card"><div className="muted">Конверсия в платных</div><div className="ring-value">{dash.conversion_percent}%</div></div>
        </div>
      )}

      {tab === "users" && (
        <div>
          <div className="row">
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="telegram_id / username" style={{ marginBottom: 0 }} />
            <button className="btn small" onClick={loadUsers} style={{ flex: "0 0 auto" }}>Поиск</button>
          </div>
          {users.map((u) => (
            <div key={u.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{u.name || u.username || u.telegram_id}</strong>
                {u.sub_type && <span className="pill">{u.sub_type}</span>}
              </div>
              <div className="muted">tg: {u.telegram_id}{u.is_admin ? " · admin" : ""}{u.is_blocked ? " · 🚫" : ""}</div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn secondary small" onClick={() => Admin.grantSub(u.id, { type: "basic", days: 30 }).then(loadUsers)}>+Basic</button>
                <button className="btn secondary small" onClick={() => Admin.grantSub(u.id, { type: "trainer", days: 365 }).then(loadUsers)}>+Trainer</button>
                {u.is_blocked ? (
                  <button className="btn ghost small" onClick={() => Admin.unblock(u.id).then(loadUsers)}>Разблок</button>
                ) : (
                  <button className="btn ghost small" onClick={() => Admin.block(u.id).then(loadUsers)}>Блок</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "logs" && (
        <div>
          {logs.map((l) => (
            <div key={l.id} className="card" style={{ padding: 10 }}>
              <div className="macro-head">
                <span className="pill">{l.action}</span>
                <span className="muted">{new Date(l.created_at).toLocaleString("ru-RU")}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>uid {l.user_id} · {JSON.stringify(l.details)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
