import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { api, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useModal } from "../../lib/hooks";
import { fadeMotion, motionTokens, springs } from "../../lib/motion";
import { dateTime, isoDate, pct } from "../../lib/format";
import { Card, Icon, PlusIcon, ProblemCard, Status, Toast, errorText, exportCsv, mailtoHref, shareReport } from "../../components/ui.jsx";

// Самая проблемная школа (списания за неделю не ниже порога) подсвечивается красным.
const HIGH_WASTE_PCT = 20;
const STATS_DAYS = 7;

// Панель справа «Приглашение директора»: № школы + ФИО → личная ссылка (показывается один раз).
function InvitePanel({ school, onClose, onCreated }) {
  const [form, setForm] = useState({ school_number: school?.number || "", full_name: "" });
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  useModal(ref, onClose);

  // busy: двойной клик не создаёт две ссылки.
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.post("/kombinat/links", { full_name: form.full_name, school_number: Number(form.school_number) });
      setResult(r);
      setMessage(null);
      onCreated();
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.link.url);
      setMessage("Ссылка скопирована. Отправьте её директору - второй раз её не показать.");
    } catch {
      setMessage("Скопируйте ссылку из поля вручную.");
    }
  };

  return <>
    <motion.div className="side-panel-backdrop" onClick={onClose} {...fadeMotion} />
    <motion.form
      ref={ref}
      className="side-panel"
      onSubmit={submit}
      role="dialog"
      aria-modal="true"
      aria-label="Приглашение директора"
      initial={{ opacity: 0, x: motionTokens.distance.lg }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: motionTokens.distance.lg, transition: { duration: motionTokens.duration.fast } }}
      transition={springs.gentle}
    >
      <div className="side-panel-head">
        <h3>Приглашение директора</h3>
        <button type="button" className="side-panel-close" onClick={onClose} aria-label="Закрыть">×</button>
      </div>
      {school?.director_name && <p className="muted">Сейчас: {school.director_name}. Новая ссылка не отзывает старые.</p>}
      {/* Фокус сразу в первое пустое поле: № школы или, если школа выбрана, ФИО. */}
      <input type="number" min="1" placeholder="№ школы" aria-label="№ школы" value={form.school_number} onChange={set("school_number")} required data-autofocus={school ? undefined : true} />
      <input placeholder="ФИО" aria-label="ФИО директора" value={form.full_name} onChange={set("full_name")} required data-autofocus={school ? true : undefined} />
      <p className="hint">Школа и директор создадутся автоматически, если их ещё нет. Ссылка открывает кабинет без пароля.</p>
      {result && <input readOnly value={result.link.url} onFocus={(e) => e.target.select()} aria-label="Ссылка приглашения" />}
      {message && <p className="hint">{message}</p>}
      <button type="submit" disabled={busy}>{busy ? "Создаём..." : "Создать ссылку приглашения"}</button>
      <button type="button" className="secondary" onClick={copy} disabled={!result}>Скопировать ссылку приглашения</button>
    </motion.form>
  </>;
}

function Links({ links }) {
  const { data, loading, error, reload } = links;
  const [message, setMessage] = useState(null);

  // Отзыв необратим: директор сразу теряет доступ, поэтому спрашиваем.
  const revoke = async (link) => {
    const who = link.role === "kombinat" ? "комбината" : `${link.director_name} (${link.school_name})`;
    if (!window.confirm(`Отозвать ссылку ${who}? Вход по ней сразу перестанет работать.`)) return;
    const id = link.id;
    try {
      await api.del(`/kombinat/links/${id}`);
      setMessage(null);
      reload();
    } catch (err) {
      setMessage(errorText(err));
    }
  };

  return (
    <Card title="Выданные ссылки">
      <Status loading={loading && !data} error={error} />
      {message && <p className="error">{message}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>Кому</th><th>Создана</th><th>Последний вход</th><th>Статус</th><th /></tr></thead>
        <tbody>
          {data?.links.map((l) => (
            <tr key={l.id}>
              <td>{l.role === "kombinat" ? "Комбинат" : `${l.director_name}, ${l.school_name}`}</td>
              <td>{dateTime(l.created_at)}</td>
              <td>{dateTime(l.last_used_at)}</td>
              <td>{l.revoked_at ? "отозвана" : "активна"}</td>
              <td className="action">{!l.revoked_at && <button className="link" onClick={() => revoke(l)}>Отозвать</button>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </Card>
  );
}

export default function KombinatSchools() {
  const { data, loading, error, reload } = useApi("/kombinat/schools");
  const dashboard = useApi("/kombinat/dashboard");
  const stats = useApi(`/kombinat/stats${qs({ from: isoDate(-STATS_DAYS), to: isoDate() })}`);
  const links = useApi("/kombinat/links");
  const [invite, setInvite] = useState(null);
  const [toast, setToast] = useState(null);
  const onCreated = () => { reload(); links.reload(); };

  const rows = (data?.schools || []).map((s) => {
    const week = stats.data?.schools.find((item) => item.id === s.id);
    const today = dashboard.data?.schools.find((item) => item.id === s.id);
    return {
      ...s,
      students: today?.cards.kids.students,
      eatenPct: week?.plannedRub ? Math.round(100 - week.wastePct) : null,
      wastePct: week?.plannedRub ? week.wastePct : null,
      recommendations: today?.recommendations || []
    };
  });
  const worst = rows.filter((s) => s.wastePct !== null && s.wastePct >= HIGH_WASTE_PCT)
    .sort((a, b) => b.wastePct - a.wastePct)[0];
  const problemLines = worst && [
    `Проблемная школа: ${worst.number}.`,
    `${pct(worst.wastePct)} еды списывается за последние ${STATS_DAYS} дней.`,
    worst.recommendations[0] ? `Причина: ${worst.recommendations[0].text}` : null
  ];
  const reportText = rows.map((s) => `${s.name}: съели ${pct(s.eatenPct)}, списали ${pct(s.wastePct)}`).join("\n");

  return (
    <>
      <div className="page-heading">
        <h1>Школы</h1>
        <button className="add-link" onClick={() => setInvite({ school: null })}><PlusIcon />Пригласить директора</button>
      </div>
      <Status loading={loading && !data} error={error} />
      <div className="table-wrap"><table>
        <thead><tr><th>Школа</th><th className="num">Детей</th><th className="num">Съели</th><th className="num">Списали</th><th className="action">Действие</th></tr></thead>
        <tbody>
          {rows.map((s) => {
            const bad = s.id === worst?.id;
            return <tr key={s.id} className={bad ? "row-bad" : ""} title={s.name} data-focus={`school-${s.id}`}>
              <td><span className={`dot${s.wastePct === null ? " none" : bad ? " bad" : ""}`} />{s.number}</td>
              <td className="num">{s.students ?? "-"}</td>
              <td className="num">{pct(s.eatenPct)}</td>
              <td className="num">{pct(s.wastePct)}</td>
              <td className="action"><button className="plain" onClick={() => setInvite({ school: s })}>Открыть</button></td>
            </tr>;
          })}
        </tbody>
      </table></div>
      {(dashboard.error || stats.error) && <p className="muted">Сводные показатели по школам сейчас недоступны.</p>}
      {worst && <ProblemCard
        title="Проблемная школа"
        lines={problemLines}
        action={<a className="button" href={mailtoHref(`Списания: ${worst.name}`, problemLines.filter(Boolean).join("\n"))}>Отправить рекомендации технологу</a>}
      />}
      <Toast>{toast}</Toast>
      <div className="bottom-actions">
        <button onClick={() => exportCsv(`trayeye-shkoly-${isoDate()}.csv`, [["Школа", "Детей", "Съели, %", "Списали, %", "Директор"], ...rows.map((s) => [s.name, s.students, s.eatenPct, s.wastePct, s.director_name])])}>
          <Icon name="arrowDown" size={20} />Экспорт в Excel
        </button>
        <button className="secondary" onClick={async () => setToast(await shareReport(`Школы за ${STATS_DAYS} дней`, reportText))}>
          <Icon name="stats" size={20} />Отправить отчёт
        </button>
      </div>
      <Links links={links} />
      {/* В body: у страницы во время анимации есть transform, а он ломает position: fixed. */}
      {createPortal(
        <AnimatePresence>
          {invite && <InvitePanel key={invite.school?.id ?? "new"} school={invite.school} onClose={() => setInvite(null)} onCreated={onCreated} />}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
