import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Employees } from "../api";
import { useFetch, useLive, Stat, Loader, money, fmtDay } from "../lib.jsx";

// Раздел «Работники»: сотрудники-пиарщики. Добавление по Telegram ID или @username
// (человек должен уже нажимать /start в боте), сводка сверху, список с ключевыми
// цифрами, клик по строке — карточка с деталями и выплатами.

// Кружок-аватар с первой буквой имени (единый стиль с карточкой сотрудника).
export function AvatarDot({ name, size = 34 }) {
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span style={{
      width: size, height: size, borderRadius: "50%", background: "var(--grad)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 800, fontSize: size * 0.44, flex: "0 0 auto"
    }}>{letter}</span>
  );
}

// Кнопка «Копировать» с подтверждением «✓ Скопировано» на пару секунд.
export function CopyButton({ text, label = "Копировать", small = true }) {
  const [done, setDone] = useState(false);
  const copy = (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    }).catch(() => {});
  };
  return (
    <button className={"btn ghost" + (small ? " sm" : "")} onClick={copy}
      style={done ? { color: "#7ee2a8" } : undefined}>
      {done ? "✓ Скопировано" : label}
    </button>
  );
}

const ADD_ERRORS = {
  user_not_found: "Этот человек ещё не запускал бота. Попроси его нажать /start в боте и добавь снова.",
  already_employee: "Этот человек уже сотрудник — он есть в списке ниже."
};

export default function EmployeesPage() {
  const navigate = useNavigate();
  const { intervalMs } = useLive();
  const { data, loading, reload } = useFetch(Employees.list, [], { intervalMs });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(null);

  const list = data?.employees || [];
  const active = list.filter((e) => e.active);
  // Сводка по всем сотрудникам — видно состояние «конторы» одним взглядом.
  const sum = (f) => list.reduce((a, e) => a + (Number(f(e)) || 0), 0);
  const totals = {
    refs: sum((e) => e.refs_confirmed),
    pending: sum((e) => e.refs_pending),
    revenue: sum((e) => e.revenue),
    paid: sum((e) => e.paid_total),
    unpaidRefs: sum((e) => e.refs_unpaid),
    unpaidPays: sum((e) => e.payments_unpaid)
  };

  const add = async (e) => {
    e.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const d = await Employees.add(query.trim());
      const u = d?.employee;
      setOk(`Сотрудник добавлен${u?.username ? ` — @${u.username}` : ""}. Бот прислал ему команды /ref и /stat.`);
      setQuery("");
      reload();
    } catch (ex) {
      const code = ex?.response?.data?.error;
      setErr(ADD_ERRORS[code] || "Не получилось добавить: " + (code || ex.message));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (emp) => {
    const name = emp.name || (emp.username ? "@" + emp.username : emp.telegram_id);
    if (!window.confirm(`Убрать роль сотрудника у «${name}»?\n\nЕго ссылка перестанет работать, но вся статистика и история выплат останутся здесь.`)) return;
    try {
      await Employees.remove(emp.id);
      reload();
    } catch (ex) {
      alert("Не получилось: " + (ex?.response?.data?.error || ex.message));
    }
  };

  const readd = async (emp) => {
    try {
      await Employees.add(String(emp.telegram_id));
      reload();
    } catch (ex) {
      alert("Не получилось: " + (ex?.response?.data?.error || ex.message));
    }
  };

  return (
    <div>
      <div className="topbar">
        <h1 className="page-title">
          Работники
          {active.length > 0 && (
            <span className="pill violet" style={{ marginLeft: 10, verticalAlign: "middle" }}>
              активных: {active.length}
            </span>
          )}
        </h1>
        <form className="row" onSubmit={add}>
          <input
            className="input"
            style={{ width: 260 }}
            placeholder="Telegram ID или @username"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setErr(null); setOk(null); }}
          />
          <button className="btn" type="submit" disabled={busy || !query.trim()}>
            {busy ? "Добавляю…" : "+ Добавить"}
          </button>
        </form>
      </div>

      {err && <div className="err">{err}</div>}
      {ok && (
        <div className="err" style={{ background: "color-mix(in srgb, var(--green) 14%, transparent)", color: "#7ee2a8" }}>
          {ok}
        </div>
      )}

      {loading ? <Loader /> : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 20 }}>
            <Stat label="Приведено людей" value={totals.refs}
              sub={totals.pending ? `+${totals.pending} на проверке` : "все проверены"} />
            <Stat label="Принесли денег" value={money(totals.revenue)} sub="оплаты их рефералов" />
            <Stat label="Выплачено сотрудникам" value={money(totals.paid)} sub="по отметкам выплат" />
            <Stat label="Ждут выплаты" value={`${totals.unpaidRefs} чел. / ${totals.unpaidPays} подп.`}
              sub={totals.unpaidRefs + totals.unpaidPays > 0 ? "есть невыплаченное" : "всё закрыто"} />
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Сотрудник</th><th>Ссылка</th><th>Переходы</th><th>Рефералы</th>
                  <th>Оплаты</th><th>Принёс</th><th>Не выплачено</th><th>Статус</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const unpaid = (e.refs_unpaid || 0) + (e.payments_unpaid || 0);
                  return (
                    <tr key={e.id} onClick={() => navigate(`/employees/${e.id}`)} style={{ cursor: "pointer" }}>
                      <td data-label="Сотрудник">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                          <AvatarDot name={e.name || e.username} />
                          <span>
                            <span style={{ fontWeight: 700 }}>{e.name || "Без имени"}</span>
                            {e.username && <span className="muted"> @{e.username}</span>}
                            <div className="muted" style={{ fontSize: 12 }}>с {fmtDay(e.created_at)}</div>
                          </span>
                        </span>
                      </td>
                      <td data-label="Ссылка" onClick={(ev) => ev.stopPropagation()}>
                        <CopyButton text={e.link} />
                      </td>
                      <td data-label="Переходы">{e.clicks}</td>
                      <td data-label="Рефералы">
                        <b>{e.refs_confirmed}</b>
                        {e.refs_pending > 0 && <span className="pill amber" style={{ marginLeft: 6 }}>+{e.refs_pending}</span>}
                      </td>
                      <td data-label="Оплаты">{e.payments_count}</td>
                      <td data-label="Принёс"><b>{money(e.revenue)}</b></td>
                      <td data-label="Не выплачено">
                        {unpaid > 0
                          ? <span className="pill amber">{e.refs_unpaid} чел. / {e.payments_unpaid} подп.</span>
                          : <span className="muted">—</span>}
                      </td>
                      <td data-label="Статус">
                        <span className={"pill " + (e.active ? "green" : "red")}>{e.active ? "активен" : "отключён"}</span>
                      </td>
                      <td onClick={(ev) => ev.stopPropagation()}>
                        {e.active
                          ? <button className="btn ghost sm" onClick={() => remove(e)}>Убрать</button>
                          : <button className="btn ghost sm" onClick={() => readd(e)}>Вернуть</button>}
                      </td>
                    </tr>
                  );
                })}
                {!list.length && (
                  <tr><td colSpan={9} className="muted" style={{ textAlign: "center", cursor: "default" }}>
                    Сотрудников пока нет. Добавь первого: попроси человека нажать /start в боте,
                    затем введи его Telegram ID или @username в поле сверху.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            Сотрудник получает ссылку командой /ref и видит свою статистику по /stat (только цифры, без имён).
            Реферал засчитывается через 24 часа: человек должен быть новым, открыть приложение, вступить в канал и не уйти.
          </p>
        </>
      )}
    </div>
  );
}
