import { useState } from "react";
import { api, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { dayLong, isoDate, pct } from "../../lib/format";
import { DateInput, Icon, ProblemCard, Status, errorText, exportCsv, mailtoHref, shareReport } from "../../components/ui.jsx";

// Ниже этого порога посещаемость класса считается проблемой (строка краснеет).
const LOW_ATTENDANCE_PCT = 70;

function attendancePct(cls) {
  if (cls.present_count === null || cls.present_count === undefined || !cls.students_count) return null;
  return Math.round((cls.present_count / cls.students_count) * 100);
}

function ClassRow({ cls, date, onSaved }) {
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

  return <tr className={bad ? "row-bad" : ""}>
    <td><span className={`dot${attendance === null ? " none" : bad ? " bad" : ""}`} />{cls.name}</td>
    <td className="num">{cls.students_count}</td>
    <td className="num">{cls.present_count ?? "-"}</td>
    <td className="num">{pct(attendance)}</td>
    <td className="action">
      {editing
        ? <span className="inline">
            <input aria-label={`Сколько пришло: ${cls.name}`} type="number" min="0" max={cls.students_count} value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 80 }} />
            <button onClick={save} disabled={value === ""}>Сохранить</button>
            <button className="link" onClick={() => setEditing(false)}>Отмена</button>
          </span>
        : <button className="plain" onClick={() => setEditing(true)}>Открыть</button>}
      {message && <div className="error">{message}</div>}
    </td>
  </tr>;
}

export default function DirectorClasses() {
  const [date, setDate] = useState(isoDate());
  const [toast, setToast] = useState(null);
  const { data, loading, error, reload } = useApi(`/director/classes${qs({ date })}`);
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
      <div className="table-wrap"><table>
        <thead><tr><th>Класс</th><th className="num">Детей</th><th className="num">Пришли</th><th className="num">Посещаемость</th><th className="action">Действие</th></tr></thead>
        <tbody>{classes.map((cls) => <ClassRow key={`${cls.id}-${date}`} cls={cls} date={date} onSaved={reload} />)}</tbody>
      </table></div>
      {worst && <ProblemCard
        title="Проблемный класс"
        lines={problemLines}
        action={<a className="button" href={mailtoHref(`Посещаемость: ${worst.name}`, problemLines.join("\n"))}>Отправить рекомендации технологу</a>}
      />}
      {toast && <p className="toast">{toast}</p>}
      <div className="bottom-actions">
        <button onClick={() => exportCsv(`trayeye-klassy-${date}.csv`, [["Класс", "Учеников", "Пришли", "Посещаемость, %"], ...classes.map((cls) => [cls.name, cls.students_count, cls.present_count, attendancePct(cls)])])}>
          <Icon name="arrowDown" size={20} />Экспорт в Excel
        </button>
        <button className="secondary" onClick={async () => setToast(await shareReport("Посещаемость классов", reportText))}>
          <Icon name="stats" size={20} />Отправить в комбинат
        </button>
      </div>
    </>}
  </>;
}
