import { useState } from "react";
import { api, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useDateParam } from "../../lib/hooks";
import { dayLong, isoDate, pct } from "../../lib/format";
import { DateInput, Icon, ProblemCard, Status, Toast, errorText, exportCsv, mailtoHref, sendReportToKombinat } from "../../components/ui.jsx";

// Ниже этого порога посещаемость класса считается проблемой (строка краснеет).
const LOW_ATTENDANCE_PCT = 70;

function attendancePct(cls) {
  if (cls.present_count === null || cls.present_count === undefined || !cls.students_count) return null;
  return Math.round((cls.present_count / cls.students_count) * 100);
}

function ClassRow({ cls, date, locked, onSaved }) {
  const [value, setValue] = useState(cls.present_count ?? "");
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(false);
  const attendance = attendancePct(cls);
  const bad = attendance !== null && attendance < LOW_ATTENDANCE_PCT;
  const save = async () => {
    try {
      await api.put(`/director/classes/${cls.id}/attendance`, { date, present_count: Number(value) });
      setMessage(null); setEditing(false); onSaved();
    } catch (err) { setMessage(errorText(err)); }
  };

  return <tr className={bad ? "row-bad" : ""} data-focus={`class-${cls.id}`}>
    <td><span className={`dot${attendance === null ? " none" : bad ? " bad" : ""}`} />{cls.name}</td>
    <td className="num">{cls.students_count}</td>
    <td className="num">{cls.present_count ?? "-"}</td>
    <td className="num">{pct(attendance)}</td>
    <td className="action">
      {editing
        ? <span className="inline">
            <input aria-label={`Сколько пришло: ${cls.name}`} type="number" min="0" max={cls.students_count} value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 80 }} />
            <button onClick={save} disabled={value === "" || locked}>Сохранить</button>
            <button className="link" onClick={() => setEditing(false)}>Отмена</button>
          </span>
        : <button className="plain row-link" onClick={() => setEditing(true)} disabled={locked} aria-label={`Отметить посещаемость: ${cls.name}`}>Отметить</button>}
      {message && <div className="error">{message}</div>}
    </td>
  </tr>;
}

export default function DirectorClasses() {
  const [date, setDate] = useDateParam(isoDate());
  const [toast, setToast] = useState(null);
  const { data, loading, error, stale, reload } = useApi(`/director/classes${qs({ date })}`);
  const classes = data?.classes || [];
  const present = classes.reduce((sum, cls) => sum + (cls.present_count || 0), 0);
  const students = classes.reduce((sum, cls) => sum + cls.students_count, 0);
  const marked = classes.filter((cls) => attendancePct(cls) !== null);
  const worst = marked.filter((cls) => attendancePct(cls) < LOW_ATTENDANCE_PCT)
    .sort((a, b) => attendancePct(a) - attendancePct(b))[0];

  const reportText = [
    `Посещаемость за ${dayLong(date)}: ${present} из ${students} учеников.`,
    ...marked.map((cls) => `${cls.name}: ${cls.present_count}/${cls.students_count} (${attendancePct(cls)}%)`)
  ].join("\n");
  const problemLines = worst && [
    `Проблемный класс: ${worst.name}.`,
    `Пришли ${attendancePct(worst)}% учеников (${worst.present_count} из ${worst.students_count}).`,
    "Проверьте отметку посещаемости и скорректируйте заказ порций."
  ];

  return <>
    <div className="page-heading"><h1>Классы</h1><div className="page-tools"><DateInput value={date} onChange={setDate} /></div></div>
    <Status loading={loading && !data} error={error} />
    {data && <>
      <div className={`table-wrap${stale ? " stale" : ""}`}><table>
        <thead><tr><th>Класс</th><th className="num">Детей</th><th className="num">Пришли</th><th className="num">Посещаемость</th><th className="action">Действие</th></tr></thead>
        {/* Строки привязаны к дате ответа: пока грузится другой день, старые цифры
            не правятся и не попадут в новую дату. */}
        <tbody>{classes.map((cls) => <ClassRow key={`${cls.id}-${data.date}`} cls={cls} date={data.date} locked={stale} onSaved={reload} />)}</tbody>
      </table></div>
      {worst && !stale && <ProblemCard
        title="Проблемный класс"
        lines={problemLines}
        action={<a className="button" href={mailtoHref(`Посещаемость: ${worst.name}`, problemLines.join("\n"))}>Отправить рекомендации технологу</a>}
      />}
      <Toast>{toast}</Toast>
      <div className="bottom-actions">
        <button disabled={stale} onClick={() => exportCsv(`trayeye-klassy-${date}.csv`, [["Класс", "Учеников", "Пришли", "Посещаемость, %"], ...classes.map((cls) => [cls.name, cls.students_count, cls.present_count, attendancePct(cls)])])}>
          <Icon name="arrowDown" size={20} />Экспорт в Excel
        </button>
        <button className="secondary" disabled={stale} onClick={async () => setToast(await sendReportToKombinat({ type: "attendance", date: data.date }))}>
          <Icon name="stats" size={20} />Отправить в комбинат
        </button>
      </div>
    </>}
  </>;
}
