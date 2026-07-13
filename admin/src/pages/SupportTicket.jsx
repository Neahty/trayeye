import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Support } from "../api";
import { useFetch, useLive, Loader, fmtDate } from "../lib.jsx";

// Фото из Telegram: качаем blob через axios (Bearer-токен), показываем через objectURL.
function TgPhoto({ fileId }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let obj = null;
    Support.photoBlob(fileId)
      .then((blob) => { obj = URL.createObjectURL(blob); setUrl(obj); })
      .catch(() => setFailed(true));
    return () => { if (obj) URL.revokeObjectURL(obj); };
  }, [fileId]);

  if (failed) return <div className="muted">📷 фото недоступно</div>;
  if (!url) return <div className="muted">📷 загрузка фото…</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Фото из тикета" style={{ maxWidth: 320, maxHeight: 320, borderRadius: 8, display: "block" }} />
    </a>
  );
}

function Message({ m }) {
  const isAdmin = m.sender === "admin";
  return (
    <div style={{ display: "flex", justifyContent: isAdmin ? "flex-end" : "flex-start", marginBottom: 10 }}>
      <div className="card" style={{ maxWidth: "75%", padding: "10px 14px" }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
          {isAdmin
            ? `🛠 ${m.admin_name || "Админ"}${m.via === "web" ? " (из админки)" : ""}`
            : "👤 Пользователь"}
          {" · "}{fmtDate(m.created_at)}
        </div>
        {m.photo_file_id && <TgPhoto fileId={m.photo_file_id} />}
        {m.text && <div style={{ whiteSpace: "pre-wrap", marginTop: m.photo_file_id ? 6 : 0 }}>{m.text}</div>}
      </div>
    </div>
  );
}

export default function SupportTicket() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { intervalMs } = useLive();
  const { data, loading, reload } = useFetch(() => Support.ticket(id), [id], { intervalMs });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const r = await Support.reply(id, t);
      setText("");
      if (r.warning === "user_blocked_bot") {
        alert("Пользователь заблокировал бота — ответ сохранён в истории, но не доставлен.");
      }
      reload();
    } catch (err) {
      const code = err?.response?.data?.error;
      if (code === "ticket_closed") { alert("Тикет уже закрыт."); reload(); }
      else alert("Не удалось отправить ответ: " + (code || err.message));
    } finally {
      setSending(false);
    }
  };

  const close = async () => {
    if (!window.confirm(`Закрыть тикет №${data?.ticket?.ticket_no ?? id}? Пользователь получит уведомление.`)) return;
    try {
      await Support.close(id);
      reload();
    } catch (err) {
      if (err?.response?.data?.error === "already_closed") { alert("Тикет уже закрыт."); reload(); }
      else alert("Не удалось закрыть тикет.");
    }
  };

  if (loading) return <Loader />;
  if (!data?.ticket) return <div className="muted">Тикет не найден.</div>;
  const t = data.ticket;
  const open = t.status === "open";

  return (
    <div>
      <div className="topbar">
        <h1 className="page-title">
          Тикет №{t.ticket_no ?? t.id}{" "}
          <span className={"pill " + (open ? "green" : "")} style={{ verticalAlign: "middle" }}>
            {open ? "открыт" : "закрыт"}
          </span>
        </h1>
        <div className="row">
          <button className="btn ghost sm" onClick={() => navigate("/support")}>← К списку</button>
          {open && <button className="btn sm" onClick={close}>Закрыть тикет</button>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div><b>{t.user_name || "Без имени"}</b>{t.username && <span className="muted"> @{t.username}</span>}<span className="muted"> · Telegram ID {t.user_id}</span></div>
        <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          {t.app_name || t.app_registered_at
            ? <>В приложении: {t.app_name || "без имени"} · зарегистрирован {fmtDate(t.app_registered_at)} · приложение {t.app_opened ? "открывал ✅" : "не открывал ❌"}</>
            : "Не найден в базе приложения"}
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          Создан {fmtDate(t.created_at)}{t.closed_at && <> · закрыт {fmtDate(t.closed_at)}</>}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        {data.messages.map((m) => <Message key={m.id} m={m} />)}
        {!data.messages.length && <div className="muted">Сообщений нет.</div>}
      </div>

      {open ? (
        <form onSubmit={send} className="card" style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            className="input"
            style={{ flex: 1, minHeight: 70, resize: "vertical" }}
            placeholder="Ответ пользователю — уйдёт в Telegram от имени бота поддержки"
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn" disabled={sending || !text.trim()}>
            {sending ? "Отправка…" : "Отправить"}
          </button>
        </form>
      ) : (
        <div className="muted">Тикет закрыт. Если пользователь напишет снова — создастся новый.</div>
      )}
    </div>
  );
}
