import { useState } from "react";
import { api, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { isoDate, pct } from "../../lib/format";
import { Card, DateInput, exportCsv, Status, errorText } from "../../components/ui.jsx";

function ClassRow({ cls, date, onSaved }) {
  const [value, setValue] = useState(cls.present_count ?? "");
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(false);
  const attendance = cls.students_count ? Math.round((Number(cls.present_count || 0) / cls.students_count) * 100) : 0;
  const save = async () => {
    try {
      await api.put(`/director/classes/${cls.id}/attendance`, { date, present_count: Number(value) });
      setMessage("Сохранено"); setEditing(false); onSaved();
    } catch (err) { setMessage(errorText(err)); }
  };

  return <tr>
    <td><span className={`school-dot ${attendance < 70 ? "dot-warning" : ""}`} />{cls.name}</td>
    <td>{cls.students_count}</td>
    <td>{pct(attendance)}</td>
    <td>{editing ? <span className="inline"><input aria-label={`Сколько пришло: ${cls.name}`} type="number" min="0" max={cls.students_count} value={value} onChange={(e) => setValue(e.target.value)} /><button onClick={save} disabled={value === ""}>Сохранить</button><button className="secondary" onClick={() => setEditing(false)}>Отмена</button></span> : <button className="link" onClick={() => setEditing(true)}>Изменить посещаемость</button>}</td>
    <td className="muted">{message}</td>
  </tr>;
}

export default function DirectorClasses() {
  const [date, setDate] = useState(isoDate());
  const { data, loading, error, reload } = useApi(`/director/classes${qs({ date })}`);
  const present = data?.classes.reduce((sum, cls) => sum + (cls.present_count || 0), 0) ?? 0;
  const students = data?.classes.reduce((sum, cls) => sum + cls.students_count, 0) ?? 0;
  const lowAttendance = data?.classes.filter((cls) => cls.students_count && cls.present_count / cls.students_count < .7) || [];

  return <>
    <div className="page-heading"><h1>Классы</h1><div className="page-tools"><DateInput value={date} onChange={setDate} />{data && <button onClick={() => exportCsv(`trayeye-klassy-${date}.csv`, [["Класс", "Учеников", "Пришли", "Посещаемость, %"], ...data.classes.map((cls) => [cls.name, cls.students_count, cls.present_count, cls.students_count ? Math.round(cls.present_count / cls.students_count * 100) : 0])])}>⇩　Экспорт в Excel</button>}</div></div>
    <Status loading={loading && !data} error={error} />
    {data && <>
      <Card title="Посещаемость за день"><p className="big">{present}<span className="muted"> / {students}</span></p><p className="muted">Учеников пришли сегодня</p></Card>
      <Card title="Список классов">
        <div className="table-wrap"><table><thead><tr><th>Класс</th><th>Детей</th><th>Пришли</th><th>Действие</th><th /></tr></thead><tbody>
          {data.classes.map((cls) => <ClassRow key={`${cls.id}-${date}`} cls={cls} date={date} onSaved={reload} />)}
        </tbody></table></div>
      </Card>
      {lowAttendance.length > 0 && <section className="problem-card"><h3>Классы с низкой посещаемостью</h3><p>{lowAttendance.map((cls) => `${cls.name} — ${pct(Math.round(cls.present_count / cls.students_count * 100))}`).join(" · ")}</p><p>Проверьте отмеченное количество учеников. Порог для этого уведомления — 70%.</p></section>}
    </>}
  </>;
}
