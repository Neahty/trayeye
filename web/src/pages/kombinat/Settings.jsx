import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { rub } from "../../lib/format";
import { useSession } from "../../session.jsx";
import { Card, Status, Toast, errorText } from "../../components/ui.jsx";
import { TelegramButton } from "../../components/TelegramDialog.jsx";

const RULES = [
  {
    key: "forecastMarginPct",
    label: "Запас к прогнозу заказа",
    hint: "Сколько порций заказывать сверх прогноза, чтобы хватило всем. Больше запас - меньше риск нехватки, но больше списаний."
  },
  {
    key: "problemWastePct",
    label: "Порог проблемной школы",
    hint: "Школа подсвечивается красным в разделе «Школы», если списания за неделю не ниже порога."
  },
  {
    key: "unpopularTakePct",
    label: "Блюдо «не едят», если берут меньше",
    hint: "Ниже этой доли детей блюдо попадает в рекомендации «замените блюдо в меню»."
  }
];

function formOf(data) {
  return { name: data.name, ...Object.fromEntries(RULES.map((r) => [r.key, String(data[r.key])])) };
}

// Настройки комбината: название, правила прогноза и рекомендаций, подписка, Telegram.
export default function KombinatSettings() {
  const { cabinet, refreshCabinet } = useSession();
  const { data, loading, error, reload } = useApi("/kombinat/settings");
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const readOnly = Boolean(cabinet.demo);

  useEffect(() => { if (data) setForm(formOf(data)); }, [data]);
  if (!data || !form) return <><h1>Настройки</h1><Status loading={loading} error={error} /></>;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const changed = JSON.stringify(form) !== JSON.stringify(formOf(data));

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.put("/kombinat/settings", {
        name: form.name,
        ...Object.fromEntries(RULES.map((r) => [r.key, Number(form[r.key])]))
      });
      setMessage("Сохранено. Прогноз и рекомендации уже считаются по новым правилам.");
      reload();
      refreshCabinet().catch(() => {});
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const sub = data.subscription;
  return (
    <>
      <h1>Настройки</h1>
      <div className="settings-grid">
        <form className="stack" onSubmit={save}>
          <Card title="Профиль комбината">
            <label className="setting">
              <span className="setting-label">Название</span>
              <input value={form.name} onChange={set("name")} maxLength={120} required disabled={readOnly} />
            </label>
            <p className="muted">
              Школ подключено: {sub.schools}. Ссылки директорам выдаются и отзываются в разделе <Link to="/kombinat/schools">«Школы»</Link>.
            </p>
          </Card>
          <Card title="Прогноз и рекомендации">
            {RULES.map((rule) => {
              const [min, max] = data.limits[rule.key];
              return (
                <label key={rule.key} className="setting">
                  <span className="setting-label">{rule.label}</span>
                  <span className="setting-input">
                    <input type="number" min={min} max={max} step="0.5" value={form[rule.key]} onChange={set(rule.key)} required disabled={readOnly} />%
                  </span>
                  <span className="setting-hint">{rule.hint} От {min} до {max}%.</span>
                </label>
              );
            })}
          </Card>
          <div className="settings-actions">
            <Toast>{message}</Toast>
            {readOnly && <span className="muted">В демо настройки только для просмотра.</span>}
            <button type="button" className="secondary" disabled={readOnly || !changed || busy} onClick={() => { setForm(formOf(data)); setMessage(null); }}>Отменить</button>
            <button type="submit" disabled={readOnly || !changed || busy}>{busy ? "Сохраняем..." : "Сохранить"}</button>
          </div>
        </form>

        <div className="stack">
          <Card title="Подписка TrayEye">
            <table className="settings-table"><tbody>
              <tr><td>Тариф</td><td>{rub(sub.pricePerSchool)} за школу в месяц</td></tr>
              <tr><td>Школ в подписке</td><td>{sub.schools}</td></tr>
              <tr><td>Итого в месяц</td><td><strong>{rub(sub.monthRub)}</strong></td></tr>
            </tbody></table>
            <p className="muted">Сколько подписка окупает экономией на списаниях - на <Link to="/kombinat">главной</Link>, блок «Окупаемость».</p>
          </Card>
          <Card title="Уведомления в Telegram">
            <p>Бот @TrayEye_bot присылает сводку «Сегодня» и новости школ: меню, отчёты директоров, первые входы по ссылкам.</p>
            <p className="muted">Привязано чатов комбината: {data.telegramChats}.</p>
            <TelegramButton role="kombinat" disabled={readOnly} onClosed={reload} />
          </Card>
        </div>
      </div>
    </>
  );
}
