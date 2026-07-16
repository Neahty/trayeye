import { useState } from "react";
import { Admin } from "../api";
import { useFetch, Loader, fmtDate } from "../lib.jsx";

const AUDIENCE = {
  all: "Все", subscribed: "С подпиской", unsubscribed: "Без подписки", new: "Новые (7 дней)",
  expiring: "Истекает скоро", churned: "Отписавшиеся", sub_basic: "Тариф Basic",
  sub_trainer: "Тариф Trainer", inactive: "Не активированные", user: "Выборочно",
};
const KIND = { text: "Текст", photo: "Фото + текст", buttons: "Текст + кнопки" };
const STATUS = { pending: ["В очереди", "amber"], sending: ["Идёт…", "amber"], done: ["Готово", "green"] };

export default function Notifications() {
  const { data, loading, reload } = useFetch(Admin.broadcasts, []);
  const [audience, setAudience] = useState("all");
  const [kind, setKind] = useState("text");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);
  const [buttons, setButtons] = useState([{ text: "", url: "" }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // Точечная рассылка: поиск и выбор конкретных пользователей.
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [searching, setSearching] = useState(false);

  const searchUsers = async () => {
    const q = userQuery.trim();
    if (!q) { setUserResults([]); return; }
    setSearching(true);
    try {
      const d = await Admin.users({ search: q, limit: 20 });
      setUserResults(d.users || []);
    } catch { setUserResults([]); }
    finally { setSearching(false); }
  };
  const userLabel = (u) => u.name || (u.username ? "@" + u.username : null) || String(u.telegram_id);
  const addUser = (u) => {
    setSelectedUsers((prev) => prev.some((x) => x.id === u.id) ? prev : [...prev, { id: u.id, label: userLabel(u) }]);
  };
  const removeUser = (id) => setSelectedUsers((prev) => prev.filter((x) => x.id !== id));

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() && kind !== "photo") return;
    if (audience === "user" && !selectedUsers.length) { setMsg("Ошибка: выберите хотя бы одного получателя"); return; }
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("audience", audience);
      fd.append("kind", kind);
      fd.append("text", text);
      if (audience === "user") fd.append("target_user_ids", JSON.stringify(selectedUsers.map((u) => u.id)));
      if (kind === "photo" && photo) fd.append("photo", photo);
      if (kind === "buttons") fd.append("buttons", JSON.stringify(buttons.filter((b) => b.text)));
      await Admin.sendBroadcast(fd);
      setMsg("Рассылка запущена — идёт отправка в фоне. Обновите историю через минуту, чтобы увидеть доставку.");
      setText(""); setPhoto(null);
      reload();
    } catch (e2) {
      setMsg("Ошибка: " + (e2?.response?.data?.error || e2.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="topbar"><h1 className="page-title">Рассылки</h1></div>

      <form className="card" onSubmit={send} style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 800, marginBottom: 14 }}>Массовая рассылка</div>
        {msg && <div className="err" style={{ background: "color-mix(in srgb,var(--green) 16%,transparent)", color: "#7ee2a8" }}>{msg}</div>}

        <div className="field">
          <label>Аудитория</label>
          <select className="input" value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="all">Все пользователи</option>
            <option value="subscribed">Только с подпиской</option>
            <option value="unsubscribed">Только без подписки</option>
            <option value="new">Только новые (7 дней)</option>
            <option value="expiring">Подписка истекает скоро (≤3 дн.)</option>
            <option value="churned">Отписавшиеся (вернуть)</option>
            <option value="sub_basic">Подписчики тарифа Basic</option>
            <option value="sub_trainer">Подписчики тарифа Trainer</option>
            <option value="inactive">Не активированные</option>
            <option value="user">Выборочно (конкретным людям)</option>
          </select>
        </div>

        {audience === "user" && (
          <div className="field">
            <label>Получатели</label>
            {selectedUsers.length > 0 && (
              <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {selectedUsers.map((u) => (
                  <span key={u.id} className="pill" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {u.label}
                    <button type="button" onClick={() => removeUser(u.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: 800 }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <input className="input" placeholder="Имя, @username или telegram_id"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchUsers(); } }} />
              <button type="button" className="btn ghost sm" onClick={searchUsers} disabled={searching}>{searching ? "…" : "Найти"}</button>
            </div>
            {userResults.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
                <table>
                  <tbody>
                    {userResults.map((u) => {
                      const picked = selectedUsers.some((x) => x.id === u.id);
                      return (
                        <tr key={u.id}>
                          <td>{userLabel(u)}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{u.telegram_id}</td>
                          <td style={{ textAlign: "right" }}>
                            <button type="button" className="btn ghost sm" disabled={picked} onClick={() => addUser(u)}>{picked ? "✓" : "+ Добавить"}</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="field">
          <label>Тип</label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="text">Текст</option>
            <option value="photo">Фото + текст</option>
            <option value="buttons">Текст + кнопки</option>
          </select>
        </div>

        <div className="field">
          <label>Текст сообщения</label>
          <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </div>

        {kind === "photo" && (
          <div className="field">
            <label>Фото</label>
            <input className="input" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
          </div>
        )}

        {kind === "buttons" && (
          <div className="field">
            <label>Кнопки (текст + ссылка)</label>
            {buttons.map((b, i) => (
              <div className="row" key={i} style={{ marginBottom: 8 }}>
                <input className="input" placeholder="Текст" value={b.text} onChange={(e) => setButtons((bs) => bs.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                <input className="input" placeholder="https://" value={b.url} onChange={(e) => setButtons((bs) => bs.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
              </div>
            ))}
            <button type="button" className="btn ghost sm" onClick={() => setButtons((bs) => [...bs, { text: "", url: "" }])}>+ Кнопка</button>
          </div>
        )}

        <button className="btn" disabled={busy} style={{ marginTop: 8 }}>{busy ? "Отправка…" : "Отправить рассылку"}</button>
      </form>

      <div className="row-between" style={{ alignItems: "center", margin: "26px 0 14px" }}>
        <div className="section-title" style={{ margin: 0 }}>История рассылок</div>
        <button type="button" className="btn ghost sm" onClick={reload}>Обновить</button>
      </div>
      {loading ? <Loader /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Дата</th><th>Кому</th><th>Тип</th><th>Текст</th><th>Статус</th><th>Отправлено</th><th>Доставлено</th><th>Нажатий</th></tr></thead>
            <tbody>
              {data.broadcasts.map((b) => {
                const [stLabel, stColor] = STATUS[b.status] || STATUS.done;
                return (
                  <tr key={b.id}>
                    <td>{fmtDate(b.created_at)}</td>
                    <td><span className="pill">{(AUDIENCE[b.audience] || b.audience) + (b.audience === "user" && b.target_user_ids ? ` (${b.target_user_ids.length})` : "")}</span></td>
                    <td>{KIND[b.kind] || b.kind}</td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{b.text}</td>
                    <td><span className={"pill " + stColor}>{stLabel}</span></td>
                    <td>{b.sent_count}</td>
                    <td>{b.delivered_count}</td>
                    <td>{b.click_count}</td>
                  </tr>
                );
              })}
              {!data.broadcasts.length && <tr><td colSpan={8} className="muted" style={{ textAlign: "center" }}>Рассылок ещё не было</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
