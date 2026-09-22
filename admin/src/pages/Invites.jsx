import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Invites } from "../api";
import { useFetch, useLive, Stat, Loader, fmtDate, fmtDay } from "../lib.jsx";
import { AvatarDot, CopyButton } from "./Employees.jsx";

// Раздел «Приглашения»: пользовательская программа «Пригласи друга». Сверху - период
// конкурса (фильтр по датам), топ приглашающих для выбора победителя, ниже - сквозная
// лента всех приглашений. Награда выдаётся вручную в карточке приглашающего.

// Статусы и причины отказа - те же, что у сотрудников (см. EmployeeCard.jsx):
// механика проверки 24 ч общая, поэтому и словари одинаковые.
export const INVITE_STATUS = {
  pending: { label: "на проверке", cls: "amber" },
  confirmed: { label: "засчитан", cls: "green" },
  rejected: { label: "отклонён", cls: "red" }
};

export const REJECT_REASONS = {
  app_not_opened: "не открыл приложение",
  left_channel: "вышел из канала",
  blocked_bot: "заблокировал бота"
};

// Имя пользователя одной строкой: имя, иначе @username, иначе telegram_id.
export function personName(p) {
  return p?.name || (p?.username ? "@" + p.username : String(p?.telegram_id ?? "-"));
}

const FEED_FILTERS = [
  { value: "", label: "Все" },
  { value: "confirmed", label: "Засчитанные" },
  { value: "pending", label: "На проверке" },
  { value: "rejected", label: "Отклонённые" }
];

export default function InvitesPage() {
  const navigate = useNavigate();
  const { intervalMs } = useLive();
  // Черновик периода отдельно от применённого: пока админ печатает дату, запросы не летят.
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [range, setRange] = useState({ from: "", to: "" });
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const params = { ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) };
  const { data, loading } = useFetch(() => Invites.summary(params), [range.from, range.to], { intervalMs });
  const feed = useFetch(
    () => Invites.feed({ ...params, ...(status ? { status } : {}), page, limit: 50 }),
    [range.from, range.to, status, page],
    { intervalMs }
  );

  const s = data?.summary;
  const top = data?.top || [];
  const items = feed.data?.items || [];

  const applyRange = (e) => {
    e.preventDefault();
    setRange(draft);
    setPage(1);
  };
  const resetRange = () => {
    setDraft({ from: "", to: "" });
    setRange({ from: "", to: "" });
    setPage(1);
  };

  return (
    <div>
      <div className="topbar">
        <h1 className="page-title">
          Приглашения
          {s?.inviters > 0 && (
            <span className="pill violet" style={{ marginLeft: 10, verticalAlign: "middle" }}>
              приглашающих: {s.inviters}
            </span>
          )}
        </h1>
        <form className="row" onSubmit={applyRange}>
          <input className="input" type="date" style={{ width: 160 }} value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          <input className="input" type="date" style={{ width: 160 }} value={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          <button className="btn" type="submit">Показать период</button>
          {(range.from || range.to) && <button className="btn ghost" type="button" onClick={resetRange}>Сбросить</button>}
        </form>
      </div>

      {(range.from || range.to) && (
        <p className="muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 13 }}>
          Период конкурса: {range.from || "с самого начала"} - {range.to || "по сегодня"} (по Москве).
          Считаются приглашения, созданные внутри периода.
        </p>
      )}

      {loading ? <Loader /> : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 20 }}>
            <Stat label="Засчитано друзей" value={s?.confirmed ?? 0}
              sub={s?.pending ? `+${s.pending} на проверке` : "все проверены"} />
            <Stat label="Всего приглашений" value={s?.total ?? 0} sub={`отклонено: ${s?.rejected ?? 0}`} />
            <Stat label="Переходов по ссылкам" value={s?.clicks ?? 0} sub="включая тех, кто уже был в базе" />
            <Stat label="Приглашающих" value={s?.inviters ?? 0} sub="людей, кто привёл хотя бы одного" />
          </div>

          <div className="section-title">Топ приглашающих</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Кто приглашает</th><th>Ссылка</th><th>Переходы</th>
                  <th>Засчитано</th><th>На проверке</th><th>Отклонено</th><th>Последнее</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r, i) => (
                  <tr key={r.id} onClick={() => navigate(`/invites/${r.id}`)} style={{ cursor: "pointer" }}>
                    <td data-label="#">
                      {/* Первые три места подсвечиваем - победителя конкурса видно сразу. */}
                      {i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}
                    </td>
                    <td data-label="Кто приглашает">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        <AvatarDot name={r.name || r.username} />
                        <span>
                          <span style={{ fontWeight: 700 }}>{r.name || "Без имени"}</span>
                          {r.username && <span className="muted"> @{r.username}</span>}
                          <div className="muted" style={{ fontSize: 12 }}>id {r.telegram_id}</div>
                        </span>
                      </span>
                    </td>
                    <td data-label="Ссылка" onClick={(ev) => ev.stopPropagation()}>
                      {r.link ? <CopyButton text={r.link} /> : <span className="muted">-</span>}
                    </td>
                    <td data-label="Переходы">{r.clicks}</td>
                    <td data-label="Засчитано"><b>{r.confirmed}</b></td>
                    <td data-label="На проверке">
                      {r.pending > 0 ? <span className="pill amber">{r.pending}</span> : <span className="muted">-</span>}
                    </td>
                    <td data-label="Отклонено">{r.rejected || <span className="muted">-</span>}</td>
                    <td data-label="Последнее">{fmtDay(r.last_invite_at)}</td>
                  </tr>
                ))}
                {!top.length && (
                  <tr><td colSpan={8} className="muted" style={{ textAlign: "center", cursor: "default" }}>
                    За этот период никто никого не приглашал.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>Лента приглашений</span>
            <span className="row" style={{ gap: 6 }}>
              {FEED_FILTERS.map((f) => (
                <button key={f.value}
                  className={"btn sm" + (status === f.value ? "" : " ghost")}
                  onClick={() => { setStatus(f.value); setPage(1); }}>{f.label}</button>
              ))}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Когда</th><th>Кто пригласил</th><th>Кого</th><th>Статус</th><th>Условия</th><th>Купил PRO</th></tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const st = INVITE_STATUS[r.status] || { label: r.status, cls: "" };
                  return (
                    <tr key={r.id} onClick={() => navigate(`/invites/${r.inviter_id}`)} style={{ cursor: "pointer" }}>
                      <td data-label="Когда">{fmtDate(r.created_at)}</td>
                      <td data-label="Кто пригласил">
                        <span style={{ fontWeight: 700 }}>{r.inviter_name || "Без имени"}</span>
                        {r.inviter_username && <span className="muted"> @{r.inviter_username}</span>}
                      </td>
                      <td data-label="Кого">
                        <span style={{ fontWeight: 700 }}>{r.user_name || "Без имени"}</span>
                        {r.user_username && <span className="muted"> @{r.user_username}</span>}
                        <div className="muted" style={{ fontSize: 12 }}>id {r.telegram_id}</div>
                      </td>
                      <td data-label="Статус">
                        <span className={"pill " + st.cls}>
                          {st.label}{r.reject_reason ? ` - ${REJECT_REASONS[r.reject_reason] || r.reject_reason}` : ""}
                        </span>
                      </td>
                      {/* Текущее состояние приглашённого: по нему крон и решает через 24 ч. */}
                      <td data-label="Условия" className="muted" style={{ fontSize: 12.5 }}>
                        {r.app_opened ? "открыл приложение" : "не открыл приложение"}
                        {" · "}{r.channel_member ? "в канале" : "не в канале"}
                        {r.tg_unreachable ? " · заблокировал бота" : ""}
                      </td>
                      <td data-label="Купил PRO">{r.user_paid ? "✅" : <span className="muted">-</span>}</td>
                    </tr>
                  );
                })}
                {!items.length && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: "center", cursor: "default" }}>
                    {feed.loading ? "Загружаем…" : "Приглашений здесь пока нет."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {(feed.data?.pages || 1) > 1 && (
            <div className="row" style={{ marginTop: 12, justifyContent: "center" }}>
              <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Назад</button>
              <span className="muted" style={{ fontSize: 13 }}>Стр. {page} из {feed.data.pages}</span>
              <button className="btn ghost sm" disabled={page >= feed.data.pages} onClick={() => setPage((p) => p + 1)}>Вперёд →</button>
            </div>
          )}

          <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
            Друг засчитывается через 24 часа: он должен быть новым, открыть приложение, вступить в канал и не уйти.
            Награду победителю выдавай в его карточке кнопкой «Выдать PRO».
          </p>
        </>
      )}
    </div>
  );
}
