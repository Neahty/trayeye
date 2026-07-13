import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Support } from "../api";
import { useFetch, useLive, Loader, fmtDate } from "../lib.jsx";

const STATUSES = [
  { value: "open", label: "Открытые" },
  { value: "closed", label: "Закрытые" },
  { value: "all", label: "Все" }
];

export default function SupportPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("open");
  const { intervalMs } = useLive();
  const { data, loading } = useFetch(() => Support.tickets({ status }), [status], { intervalMs });

  return (
    <div>
      <div className="topbar">
        <h1 className="page-title">
          Поддержка
          {data?.open_count > 0 && (
            <span className="pill green" style={{ marginLeft: 10, verticalAlign: "middle" }}>
              открытых: {data.open_count}
            </span>
          )}
        </h1>
        <div className="row">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? <Loader /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>№</th><th>Статус</th><th>Пользователь</th><th>Тема</th><th>Сообщений</th><th>Обновлён</th></tr>
            </thead>
            <tbody>
              {data.tickets.map((t) => (
                <tr key={t.id} onClick={() => navigate(`/support/${t.id}`)} style={{ cursor: "pointer" }}>
                  <td data-label="№">№{t.ticket_no ?? t.id}</td>
                  <td data-label="Статус">
                    <span className={"pill " + (t.status === "open" ? "green" : "")}>
                      {t.status === "open" ? "открыт" : "закрыт"}
                    </span>
                  </td>
                  <td data-label="Пользователь">
                    {t.user_name || t.app_name || "Без имени"}
                    {t.username && <span className="muted"> @{t.username}</span>}
                  </td>
                  <td data-label="Тема" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.subject || t.last_text || "—"}
                  </td>
                  <td data-label="Сообщений">{t.message_count}</td>
                  <td data-label="Обновлён">{fmtDate(t.updated_at)}</td>
                </tr>
              ))}
              {!data.tickets.length && (
                <tr><td colSpan={6} className="muted" style={{ textAlign: "center" }}>
                  {status === "open" ? "Открытых тикетов нет 🎉" : "Пока пусто"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
