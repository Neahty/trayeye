import { useState } from "react";
import { Admin } from "../api";
import { useAuth } from "../App.jsx";
import { useFetch, useLive, Loader, fmtDate, money, subLabel, askGrantBody, useTariffMap, GRANT_PERIODS } from "../lib.jsx";

function UserModal({ id, onClose, onChanged }) {
  const { admin } = useAuth();
  const isSelf = admin && Number(admin.id) === Number(id);
  const { data, loading, reload } = useFetch(() => Admin.user(id), [id]);
  const tariffMap = useTariffMap();
  const [busy, setBusy] = useState(false);
  const [grantType, setGrantType] = useState("basic");
  const [grantDays, setGrantDays] = useState(30);

  const act = async (fn, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    try { await fn(); await reload(); onChanged && onChanged(); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {loading || !data ? <Loader /> : (
          <>
            <h2>{data.user.name || data.user.username || data.user.telegram_id}</h2>
            <div className="row" style={{ marginBottom: 14 }}>
              <span className="pill violet">Telegram: {data.user.telegram_id}</span>
              {data.user.is_admin && <span className="pill">администратор</span>}
              {data.user.is_blocked && <span className="pill red">заблокирован</span>}
              {data.user.app_opened !== false && (
                data.user.tg_unreachable
                  ? <span className="pill red">неактивный · бот в ЧС</span>
                  : data.user.channel_member === false
                    ? <span className="pill">неактивный · не подписан</span>
                    : <span className="pill green">активный</span>
              )}
              {(() => {
                // Статус подписки/пробника: «активна» только если дата реально в будущем
                // (status='active' в БД сам по себе не гаснет после expires_at).
                const s = data.subscription;
                const now = Date.now();
                if (s?.status === "active" && s.expires_at && new Date(s.expires_at).getTime() > now) {
                  return (<>
                    <span className="pill green">{subLabel(s.type, tariffMap)}</span>
                    <span className="pill">до {fmtDate(s.expires_at)}</span>
                  </>);
                }
                if (s) {
                  return new Date(s.expires_at).getTime() > now
                    ? <span className="pill red">подписка отменена (была до {fmtDate(s.expires_at)})</span>
                    : <span className="pill red">подписка истекла {fmtDate(s.expires_at)}</span>;
                }
                if (data.trial_ends_at) {
                  return new Date(data.trial_ends_at).getTime() > now
                    ? <span className="pill">пробный до {fmtDate(data.trial_ends_at)}</span>
                    : <span className="pill red">пробный истёк {fmtDate(data.trial_ends_at)}</span>;
                }
                return null;
              })()}
            </div>

            <div className="section-title" style={{ marginTop: 6 }}>Профиль</div>
            <div className="kv"><span>Пол / Возраст</span><span>{data.user.gender || "—"} · {data.user.age || "—"}</span></div>
            <div className="kv"><span>Рост / Вес</span><span>{data.user.height || "—"} см · {data.user.weight || "—"} кг</span></div>
            <div className="kv"><span>Цель / Активность</span><span>{data.user.goal || "—"} · {data.user.activity || "—"}</span></div>
            <div className="kv"><span>Норма калорий</span><span>{data.user.daily_calories || "—"} ккал</span></div>

            <div className="section-title">Активность</div>
            <div className="kv"><span>Всего входов</span><span>{data.activity.logins}</span></div>
            <div className="kv"><span>Последний вход</span><span>{fmtDate(data.activity.last_login)}</span></div>
            <div className="kv"><span>Устройство</span><span className="tag">{data.activity.device || "—"}</span></div>

            <div className="section-title">Питание</div>
            <div className="kv"><span>Всего сканов</span><span>{data.nutrition.scans}</span></div>
            <div className="kv"><span>Средняя калорийность дня</span><span>{data.nutrition.avg_day_calories} ккал</span></div>
            <div className="kv"><span>Б / Ж / У (среднее за приём)</span><span>{data.nutrition.avg_protein} / {data.nutrition.avg_fat} / {data.nutrition.avg_carbs} г</span></div>

            <div className="section-title">AI</div>
            <div className="kv"><span>Запросов к GPT</span><span>{data.ai.requests}</span></div>
            <div className="kv"><span>Токенов</span><span>{data.ai.tokens}</span></div>
            <div className="kv"><span>Стоимость</span><span>${data.ai.cost_usd}</span></div>

            <div className="section-title">Платежи</div>
            {data.payments.length ? data.payments.slice(0, 6).map((p) => (
              <div className="kv" key={p.id}><span>{fmtDate(p.created_at)} · {p.status}</span><span>{money(p.amount)}</span></div>
            )) : <div className="muted" style={{ fontSize: 13 }}>Нет платежей</div>}

            <div className="section-title" style={{ marginTop: 20 }}>Выдать подписку</div>
            <div className="row" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <div className="row" style={{ gap: 6 }}>
                {[["basic", "PRO"], ["trainer", "Тренерская"]].map(([v, l]) => (
                  <button key={v} type="button" className={"btn sm " + (grantType === v ? "" : "ghost")}
                    disabled={busy} onClick={() => setGrantType(v)}>{l}</button>
                ))}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {GRANT_PERIODS.map((p) => (
                  <button key={p.days} type="button" className={"btn sm " + (grantDays === p.days ? "" : "ghost")}
                    disabled={busy} onClick={() => setGrantDays(p.days)}>{p.label}</button>
                ))}
              </div>
              <button className="btn sm" disabled={busy}
                onClick={() => { const body = askGrantBody(grantType, grantDays, tariffMap[grantType]?.price); if (body) act(() => Admin.grantSub(id, body)); }}>
                Выдать
              </button>
            </div>

            <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
              <button className="btn ghost sm" disabled={busy} onClick={() => act(() => Admin.revokeSub(id))}>Забрать подписку</button>
              {data.user.is_blocked
                ? <button className="btn ghost sm" disabled={busy} onClick={() => act(() => Admin.unblock(id))}>Разблокировать</button>
                : !isSelf && !data.user.is_admin && <button className="btn ghost sm" disabled={busy} onClick={() => act(() => Admin.block(id))}>Заблокировать</button>}
              {!isSelf && !data.user.is_admin && <button className="btn danger sm" disabled={busy} onClick={() => act(() => Admin.deleteUser(id).then(onClose), "Удалить аккаунт безвозвратно?")}>Удалить аккаунт</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Ячейка «Подписка»: тип + когда заканчивается подписка или пробный период.
// Бывшему подписчику показываем «подписка истекла», а не дату древнего пробника.
function SubCell({ u, tariffMap }) {
  if (u.app_opened === false) return <span className="pill" style={{ opacity: 0.7 }}>не открыл приложение</span>;
  if (u.sub_type) {
    return (
      <>
        <span className="pill green">{subLabel(u.sub_type, tariffMap)}</span>
        {u.sub_expires_at && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>до {fmtDate(u.sub_expires_at)}</div>}
      </>
    );
  }
  if (u.last_sub_expires_at) {
    return (
      <>
        <span className="pill">бесплатно</span>
        <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>подписка истекла {fmtDate(u.last_sub_expires_at)}</div>
      </>
    );
  }
  const trialEnd = u.trial_ends_at ? new Date(u.trial_ends_at) : null;
  const trialActive = trialEnd && trialEnd.getTime() > Date.now();
  return (
    <>
      <span className="pill">бесплатно</span>
      {trialEnd && (
        <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
          {trialActive ? `пробник до ${fmtDate(trialEnd)}` : `пробник истёк ${fmtDate(trialEnd)}`}
        </div>
      )}
    </>
  );
}

// Статус «активный/неактивный» в списке. Активный (подписан + бот не в ЧС) — норма, без бейджа.
function StatusBadge({ u }) {
  if (u.app_opened === false) return null; // про таких SubCell уже пишет «не открыл приложение»
  if (u.tg_unreachable) return <span className="pill red" style={{ marginLeft: 6 }}>бот в ЧС</span>;
  if (u.channel_member === false) return <span className="pill" style={{ marginLeft: 6, opacity: 0.7 }}>не подписан</span>;
  return null;
}

export default function Users() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(""); // "" | "true" (активные) | "false" (неактивные)
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const tariffMap = useTariffMap();
  const { intervalMs } = useLive();
  const { data, loading, reload } = useFetch(
    () => Admin.users({ search: query, page, limit: 20, active: status || undefined }),
    [query, page, status],
    { intervalMs }
  );

  return (
    <div>
      <div className="topbar">
        <h1 className="page-title">Пользователи</h1>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(search); }}>
          <select className="input" style={{ width: "auto" }} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">Все</option>
            <option value="true">Активные</option>
            <option value="false">Неактивные</option>
          </select>
          <input className="input" style={{ width: 260 }} placeholder="ID, username или имя" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn sm">Поиск</button>
        </form>
      </div>

      {loading ? <Loader /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Telegram ID</th><th>Имя</th><th>Username</th><th>Регистрация</th><th>Последний вход</th><th>Подписка</th><th>Сканов</th></tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} onClick={() => setOpenId(u.id)}>
                    <td data-label="Telegram ID">{u.telegram_id}</td>
                    <td data-label="Имя">{u.name || "—"}{u.is_blocked && <span className="pill red" style={{ marginLeft: 6 }}>заблокирован</span>}<StatusBadge u={u} /></td>
                    <td data-label="Username">{u.username || "—"}</td>
                    <td data-label="Регистрация">{fmtDate(u.created_at)}</td>
                    <td data-label="Последний вход">{fmtDate(u.last_login_at)}</td>
                    <td data-label="Подписка"><SubCell u={u} tariffMap={tariffMap} /></td>
                    <td data-label="Сканов">{u.scans_count}</td>
                  </tr>
                ))}
                {!data.users.length && <tr><td colSpan={7} className="muted" style={{ textAlign: "center" }}>Ничего не найдено</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
            <span className="muted">Всего: {data.total}</span>
            <div className="row">
              <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Назад</button>
              <span className="muted">Стр. {page}</span>
              <button className="btn ghost sm" disabled={page * 20 >= data.total} onClick={() => setPage((p) => p + 1)}>Вперёд</button>
            </div>
          </div>
        </>
      )}

      {openId && <UserModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}
