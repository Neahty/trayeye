import { useState } from "react";
import { Quests } from "../api";
import { useFetch, useLive, Loader } from "../lib.jsx";

// Раздел «Квесты»: квесты с наградами. Пользователь выполняет условие → «Забрать награду» →
// бот присылает ему в ЛС сообщение со ссылкой. Здесь — полный CRUD: создать/изменить/удалить,
// в т.ч. поменять ссылку-награду и текст.

const EMPTY = {
  title: "", emoji: "🎯", description: "",
  criteria_type: "streak", criteria_value: 7,
  reward_title: "", reward_link: "", reward_message: "",
  active: true, sort: 0
};

function QuestModal({ quest, criteria, onClose, onSaved }) {
  const isEdit = !!quest;
  const [form, setForm] = useState(() => {
    if (!quest) return { ...EMPTY };
    return {
      title: quest.title || "", emoji: quest.emoji || "", description: quest.description || "",
      criteria_type: quest.criteria?.type || "streak",
      criteria_value: quest.criteria?.value ?? 1,
      reward_title: quest.reward_title || "", reward_link: quest.reward_link || "",
      reward_message: quest.reward_message || "",
      active: quest.active !== false, sort: quest.sort ?? 0
    };
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const meta = criteria.find((c) => c.type === form.criteria_type);
  const needsValue = meta?.needsValue;

  const save = async () => {
    if (!form.title.trim()) { setErr("Впишите название квеста"); return; }
    setBusy(true);
    setErr(null);
    const body = {
      title: form.title.trim(), emoji: form.emoji || null, description: form.description || null,
      criteria_type: form.criteria_type,
      criteria_value: needsValue ? Number(form.criteria_value) : undefined,
      reward_title: form.reward_title || null, reward_link: form.reward_link || null,
      reward_message: form.reward_message || null,
      active: !!form.active, sort: Number(form.sort) || 0
    };
    try {
      if (isEdit) await Quests.update(quest.id, body);
      else await Quests.create(body);
      onSaved();
    } catch (e) {
      const code = e?.response?.data?.error;
      setErr("Не сохранилось: " + (code || e.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose} style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: 20, zIndex: 100 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: "100%", marginTop: 20 }}>
        <h2 style={{ marginTop: 0 }}>{isEdit ? "Изменить квест" : "Новый квест"}</h2>
        {err && <div className="err">{err}</div>}

        <div className="grid cols-2" style={{ gridTemplateColumns: "80px 1fr", gap: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Эмодзи</label>
            <input className="input" value={form.emoji} maxLength={4} onChange={(e) => set("emoji", e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Название квеста</label>
            <input className="input" value={form.title} placeholder="Веди дневник 7 дней подряд" onChange={(e) => set("title", e.target.value)} />
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>Описание (необязательно)</label>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>

        <div className="grid cols-2" style={{ marginTop: 4 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Условие выполнения</label>
            <select className="input" value={form.criteria_type} onChange={(e) => set("criteria_type", e.target.value)}>
              {criteria.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
            </select>
          </div>
          {needsValue && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Цель (число)</label>
              <input className="input" type="number" min={1} value={form.criteria_value} onChange={(e) => set("criteria_value", e.target.value)} />
            </div>
          )}
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "18px 0" }} />

        <div className="field" style={{ marginBottom: 12 }}>
          <label>Награда (что даётся)</label>
          <input className="input" value={form.reward_title} placeholder="Рецепт ПП-оладушек" onChange={(e) => set("reward_title", e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Ссылка-награда</label>
          <input className="input" value={form.reward_link} placeholder="https://t.me/…" onChange={(e) => set("reward_link", e.target.value)} />
        </div>
        <div className="field">
          <label>Текст в ЛС (необязательно)</label>
          <textarea className="input" rows={4} value={form.reward_message}
            placeholder="Оставьте пустым — уйдёт красивый шаблон по умолчанию."
            onChange={(e) => set("reward_message", e.target.value)} />
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Переменные: {"{name}"} — имя, {"{quest_title}"} — название квеста, {"{reward_title}"} — награда, {"{link}"} — ссылка.
            Ссылка также добавляется кнопкой под сообщением. Поддерживается HTML (&lt;b&gt;, &lt;i&gt;).
          </div>
        </div>

        <div className="row" style={{ marginTop: 14, justifyContent: "space-between", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> Активен
          </label>
          <div className="field" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ margin: 0 }}>Порядок</label>
            <input className="input" type="number" style={{ width: 80 }} value={form.sort} onChange={(e) => set("sort", e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn" disabled={busy} onClick={save}>{busy ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </div>
    </div>
  );
}

export default function QuestsPage() {
  const { intervalMs } = useLive();
  const { data, loading, reload } = useFetch(Quests.list, [], { intervalMs });
  const [editing, setEditing] = useState(undefined); // undefined = закрыто, null = создание, object = правка

  const list = data?.quests || [];
  const criteria = data?.criteria || [];
  const critLabel = (t) => criteria.find((c) => c.type === t)?.label || t;

  const remove = async (q) => {
    if (!window.confirm(`Удалить квест «${q.title}»?\n\nВместе с ним удалятся отметки о полученных наградах у пользователей.`)) return;
    try {
      await Quests.remove(q.id);
      reload();
    } catch (e) {
      alert("Не получилось: " + (e?.response?.data?.error || e.message));
    }
  };

  return (
    <div>
      <div className="topbar">
        <h1 className="page-title">
          Квесты
          {list.length > 0 && <span className="pill violet" style={{ marginLeft: 10, verticalAlign: "middle" }}>{list.length}</span>}
        </h1>
        <button className="btn" onClick={() => setEditing(null)}>+ Новый квест</button>
      </div>

      <p className="muted" style={{ marginBottom: 14, fontSize: 13.5 }}>
        Квесты видны всем на экране «Статистика». Когда пользователь выполнит условие и нажмёт
        «Забрать награду», бот пришлёт ему в ЛС сообщение со ссылкой-наградой (один раз на пользователя).
      </p>

      {loading ? <Loader /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th></th><th>Квест</th><th>Условие</th><th>Награда</th><th>Ссылка</th><th>Получили</th><th>Статус</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((q) => (
                <tr key={q.id} onClick={() => setEditing(q)} style={{ cursor: "pointer" }}>
                  <td style={{ fontSize: 22 }}>{q.emoji || "🎯"}</td>
                  <td data-label="Квест">
                    <b>{q.title}</b>
                    {q.description && <div className="muted" style={{ fontSize: 12 }}>{q.description}</div>}
                  </td>
                  <td data-label="Условие">
                    {critLabel(q.criteria?.type)}{q.criteria?.value != null ? `: ${q.criteria.value}` : ""}
                  </td>
                  <td data-label="Награда">{q.reward_title || <span className="muted">—</span>}</td>
                  <td data-label="Ссылка">
                    {q.reward_link
                      ? <a href={q.reward_link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>ссылка ↗</a>
                      : <span className="muted">нет</span>}
                  </td>
                  <td data-label="Получили">{q.claimed_count || 0}</td>
                  <td data-label="Статус">
                    <span className={"pill " + (q.active ? "green" : "red")}>{q.active ? "активен" : "выключен"}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost sm" onClick={() => remove(q)}>Удалить</button>
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: "center", cursor: "default" }}>
                  Квестов пока нет. Нажмите «+ Новый квест», чтобы добавить первый.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined && (
        <QuestModal quest={editing} criteria={criteria}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); reload(); }} />
      )}
    </div>
  );
}
