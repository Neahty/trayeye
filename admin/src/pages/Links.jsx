import { useEffect, useState } from "react";
import { Admin } from "../api";
import { Loader } from "../lib.jsx";

// Вкладка «Ссылки»: глобальные ссылки для Главной приложения.
// Пустая ссылка → карточка на Главной прячется.
const FIELDS = [
  { key: "nutritionist_url", label: "Задать вопрос нутрициологу", hint: "Ссылка на аккаунт нутрициолога в Telegram - кнопка на Главной ведёт сюда." },
  { key: "plan_url", label: "Авторский план тренировок", hint: "Промо-карточка «Авторский план» на Главной." },
  { key: "support_url", label: "Поддержка / канал", hint: "Доп. служебная ссылка (необязательно)." },
  { key: "reviews_url", label: "Канал с отзывами", hint: "Карточка «Счастливые пользователи Pro» в Профиле, под подпиской, ведёт сюда." }
];

export default function LinksPage() {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    Admin.getSettings()
      .then((res) => {
        const s = res.settings || {};
        setForm({
          nutritionist_url: s.nutritionist_url || "",
          plan_url: s.plan_url || "",
          support_url: s.support_url || "",
          reviews_url: s.reviews_url || ""
        });
      })
      .catch((e) => setMsg("Ошибка загрузки: " + (e?.response?.data?.error || e.message)));
  }, []);

  const setVal = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await Admin.saveSettings(form);
      setMsg("Ссылки сохранены - применились в приложении");
    } catch (e) {
      setMsg("Ошибка: " + (e?.response?.data?.error || e.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="topbar"><h1 className="page-title">Ссылки</h1></div>
      <p className="muted" style={{ marginBottom: 14, fontSize: 13.5 }}>
        Глобальные ссылки для Главной приложения. Оставьте поле пустым - соответствующая карточка
        не будет показываться пользователям.
      </p>

      {msg && (
        <div className="err" style={{ background: "color-mix(in srgb,var(--green) 16%,transparent)", color: "#7ee2a8" }}>
          {msg}
        </div>
      )}

      {!form ? <Loader /> : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            {FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label>{f.label}</label>
                <input className="input" value={form[f.key] ?? ""} placeholder="https://t.me/…"
                  onChange={(e) => setVal(f.key, e.target.value)} />
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{f.hint}</div>
              </div>
            ))}
          </div>
          <button className="btn" disabled={busy} onClick={save}>
            {busy ? "Сохранение…" : "Сохранить ссылки"}
          </button>
        </>
      )}
    </div>
  );
}
