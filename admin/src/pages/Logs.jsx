import { useState } from "react";
import { Admin } from "../api";
import { useFetch, useLive, Loader, fmtDate } from "../lib.jsx";

const ACTIONS = ["", "login", "scan", "payment", "profile_update", "goal_update", "trainer_action", "admin_action", "error"];
const ACTION_LABEL = {
  "": "Все события",
  login: "Входы",
  scan: "Распознавание еды",
  payment: "Платежи",
  profile_update: "Изменение профиля",
  goal_update: "Изменение цели",
  trainer_action: "Действия тренера",
  admin_action: "Действия администратора",
  error: "Ошибки"
};
const actLabel = (a) => ACTION_LABEL[a] || a;

// Иконка + цвет «пилюли» события - чтобы лента читалась взглядом.
const ACTION_STYLE = {
  login: { icon: "🔑", cls: "" },
  scan: { icon: "🍽", cls: "" },
  payment: { icon: "💰", cls: "green" },
  profile_update: { icon: "✏️", cls: "" },
  goal_update: { icon: "🎯", cls: "" },
  trainer_action: { icon: "🏋️", cls: "" },
  admin_action: { icon: "🛠", cls: "" },
  error: { icon: "⚠️", cls: "red" }
};

// Расшифровка админских действий (details.action) человеческим языком.
const ADMIN_ACTION = {
  update_settings: "Изменил настройки",
  grant_subscription: "Выдал подписку",
  revoke_subscription: "Забрал подписку",
  make_trainer: "Выдал тренерскую подписку",
  block_user: "Заблокировал пользователя",
  unblock_user: "Разблокировал пользователя",
  delete_user: "Удалил пользователя",
  support_reply: "Ответил в поддержку",
  support_close: "Закрыл тикет поддержки",
  run_subscription_reminders: "Запустил рассылку напоминаний",
  test_subscription_reminder: "Тест напоминания себе",
  send_broadcast: "Отправил рассылку"
};

// Превращает action + details в понятную фразу вместо сырого JSON.
function describe(l) {
  const d = (l.details && typeof l.details === "object") ? l.details : {};
  switch (l.action) {
    case "login":
      return d.admin ? "Вход администратора" : "Вход в приложение";
    case "scan":
      if (d.manual) return "Добавил приём пищи вручную";
      if (d.source === "text") return `Добавил по описанию${d.count ? ` · ${d.count} блюд` : ""}`;
      if (d.source === "photo") return `Распознал по фото${d.count ? ` · ${d.count} блюд` : ""}`;
      return "Добавил приём пищи";
    case "payment":
      return `Оплата${d.amount != null ? ` ${d.amount} ₽` : ""}${d.type ? ` - ${d.type}` : ""}`;
    case "profile_update":
      return "Изменил профиль";
    case "goal_update":
      return "Изменил цели КБЖУ";
    case "trainer_action":
      return d.action ? `Тренер: ${d.action}` : "Действие тренера";
    case "admin_action": {
      const base = ADMIN_ACTION[d.action] || d.action || "Действие администратора";
      const extra = [];
      if (d.ticket_id) extra.push(`тикет #${d.ticket_id}`);
      if (d.target) extra.push(`пользователь #${d.target}`);
      if (d.type) extra.push(d.type);
      if (d.amount != null) extra.push(`${d.amount} ₽`);
      return extra.length ? `${base} (${extra.join(", ")})` : base;
    }
    case "error":
      return `Ошибка${d.where ? ` в «${d.where}»` : ""}${d.message ? `: ${d.message}` : ""}`;
    default:
      return Object.keys(d).length ? JSON.stringify(d) : "-";
  }
}

export default function Logs() {
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [filters, setFilters] = useState({});
  const { intervalMs } = useLive();
  const { data, loading } = useFetch(() => Admin.logs(filters), [filters], { intervalMs });

  const apply = (e) => {
    e.preventDefault();
    const f = {};
    if (action) f.action = action;
    if (userId) f.user_id = userId;
    setFilters(f);
  };

  return (
    <div>
      <div className="topbar">
        <h1 className="page-title">История действий</h1>
        <form className="row" onSubmit={apply}>
          <select className="input" value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 210 }}>
            {ACTIONS.map((a) => <option key={a} value={a}>{actLabel(a)}</option>)}
          </select>
          <input className="input" style={{ width: 150 }} placeholder="ID пользователя" value={userId} onChange={(e) => setUserId(e.target.value)} />
          <button className="btn sm">Показать</button>
        </form>
      </div>

      {loading ? <Loader /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Дата</th><th>Событие</th><th>Пользователь</th><th>Что произошло</th></tr></thead>
            <tbody>
              {data.logs.map((l) => {
                const st = ACTION_STYLE[l.action] || { icon: "•", cls: "" };
                return (
                  <tr key={l.id}>
                    <td data-label="Дата">{fmtDate(l.created_at)}</td>
                    <td data-label="Событие"><span className={"pill " + st.cls}>{st.icon} {actLabel(l.action)}</span></td>
                    <td data-label="Пользователь">{l.username ? `@${l.username}` : (l.telegram_id || l.user_id || "-")}</td>
                    <td data-label="Что произошло" style={{ maxWidth: 460, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={typeof l.details === "object" ? JSON.stringify(l.details) : ""}>
                      {describe(l)}
                    </td>
                  </tr>
                );
              })}
              {!data.logs.length && <tr><td colSpan={4} className="muted" style={{ textAlign: "center" }}>Пока пусто</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
