import { useState } from "react";
import { api, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { isoDate } from "../../lib/format";
import { DateInput, Status, errorText } from "../../components/ui.jsx";

function ClassRow({ cls, date, onSaved }) {
  const [value, setValue] = useState(cls.present_count ?? "");
  const [message, setMessage] = useState(null);

  const save = async () => {
    try {
      await api.put(`/director/classes/${cls.id}/attendance`, { date, present_count: Number(value) });
      setMessage("сохранено");
      onSaved();
    } catch (err) {
      setMessage(errorText(err));
    }
  };

  return (
    <tr>
      <td>{cls.name}</td>
      <td>{cls.students_count}</td>
      <td>
        <input type="number" min="0" max={cls.students_count} value={value} onChange={(e) => setValue(e.target.value)} />
        <button onClick={save} disabled={value === ""}>OK</button>
      </td>
      <td className="muted">{message}</td>
    </tr>
  );
}

export default function DirectorClasses() {
  const [date, setDate] = useState(isoDate());
  const { data, loading, error, reload } = useApi(`/director/classes${qs({ date })}`);
  const present = data?.classes.reduce((a, c) => a + (c.present_count || 0), 0) ?? 0;
  const students = data?.classes.reduce((a, c) => a + c.students_count, 0) ?? 0;

  return (
    <>
      <h1>Классы</h1>
      <DateInput value={date} onChange={setDate} />
      <Status loading={loading && !data} error={error} />
      {data && (
        <>
          <p>Пришли {present} из {students}</p>
          <table>
            <thead><tr><th>Класс</th><th>Учеников</th><th>Пришли</th><th /></tr></thead>
            <tbody>
              {data.classes.map((c) => <ClassRow key={`${c.id}-${date}`} cls={c} date={date} onSaved={reload} />)}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
