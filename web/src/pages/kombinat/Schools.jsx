import { useState } from "react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { dateTime } from "../../lib/format";
import { Card, Status, errorText } from "../../components/ui.jsx";

// Личная ссылка директору: ФИО + номер школы. Показываем её один раз - в базе она не хранится.
function CreateLink({ onCreated }) {
  const [form, setForm] = useState({ full_name: "", school_number: "", school_name: "" });
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState(null);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const body = { full_name: form.full_name, school_number: Number(form.school_number) };
    if (form.school_name.trim()) body.school_name = form.school_name;
    try {
      const r = await api.post("/kombinat/links", body);
      setResult(r);
      setMessage(null);
      setForm({ full_name: "", school_number: "", school_name: "" });
      onCreated();
    } catch (err) {
      setMessage(errorText(err));
    }
  };

  return (
    <Card title="Ссылка для директора">
      <form className="row" onSubmit={submit}>
        <input placeholder="ФИО директора" value={form.full_name} onChange={set("full_name")} required />
        <input type="number" min="1" placeholder="№ школы" value={form.school_number} onChange={set("school_number")} required />
        <input placeholder="Название (необязательно)" value={form.school_name} onChange={set("school_name")} />
        <button type="submit">Создать ссылку</button>
      </form>
      {message && <p className="error">{message}</p>}
      {result && (
        <p>
          Ссылка для {result.director.full_name} ({result.school.name}). Отправьте её директору, второй раз её не показать:
          <br />
          <input className="wide" readOnly value={result.link.url} onFocus={(e) => e.target.select()} />
        </p>
      )}
    </Card>
  );
}

function Links({ links }) {
  const { data, loading, error, reload } = links;
  const [message, setMessage] = useState(null);

  const revoke = async (id) => {
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
      <table>
        <thead><tr><th>Кому</th><th>Создана</th><th>Последний вход</th><th>Статус</th><th /></tr></thead>
        <tbody>
          {data?.links.map((l) => (
            <tr key={l.id}>
              <td>{l.role === "kombinat" ? "Комбинат" : `${l.director_name}, ${l.school_name}`}</td>
              <td>{dateTime(l.created_at)}</td>
              <td>{dateTime(l.last_used_at)}</td>
              <td>{l.revoked_at ? "отозвана" : "активна"}</td>
              <td>{!l.revoked_at && <button className="link" onClick={() => revoke(l.id)}>Отозвать</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default function KombinatSchools() {
  const { data, loading, error, reload } = useApi("/kombinat/schools");
  const links = useApi("/kombinat/links");
  const onCreated = () => {
    reload();
    links.reload();
  };

  return (
    <>
      <h1>Школы</h1>
      <Status loading={loading && !data} error={error} />
      <table>
        <thead><tr><th>№</th><th>Школа</th><th>Директор</th></tr></thead>
        <tbody>
          {data?.schools.map((s) => (
            <tr key={s.id}><td>{s.number}</td><td>{s.name}</td><td>{s.director_name || "-"}</td></tr>
          ))}
        </tbody>
      </table>
      <CreateLink onCreated={onCreated} />
      <Links links={links} />
    </>
  );
}
