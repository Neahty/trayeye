import { useState, useEffect } from "react";
import { Admin, Auth } from "../api";
import { useFetch, Loader, periodLabel } from "../lib.jsx";

function Security() {
  const [qr, setQr] = useState(null);
  const [totp, setTotp] = useState("");
  const [msg, setMsg] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [pwd, setPwd] = useState({ current_password: "", new_password: "" });

  useEffect(() => { Auth.me().then((d) => setEnabled(d.totp_enabled)).catch(() => {}); }, []);

  const start = async () => { const d = await Auth.setup2fa(); setQr(d.qr); setMsg(null); };
  const verify = async () => {
    try { await Auth.verify2fa(totp); setEnabled(true); setQr(null); setMsg("2FA включена"); }
    catch { setMsg("Неверный код"); }
  };
  const changePwd = async () => {
    try { await Auth.changePassword(pwd); setMsg("Пароль изменён"); setPwd({ current_password: "", new_password: "" }); }
    catch (e) { setMsg("Ошибка: " + (e?.response?.data?.error || e.message)); }
  };

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 800, marginBottom: 14 }}>Безопасность</div>
      {msg && <div className="err" style={{ background: "color-mix(in srgb,var(--green) 16%,transparent)", color: "#7ee2a8" }}>{msg}</div>}

      <div className="kv"><span>Вход по коду из приложения (двойная защита)</span><span>{enabled ? <span className="pill green">включена</span> : <span className="pill red">выключена</span>}</span></div>
      {!enabled && (
        <div style={{ marginTop: 12 }}>
          {!qr ? <button className="btn ghost sm" onClick={start}>Включить защиту кодом</button> : (
            <div>
              <img src={qr} alt="QR" style={{ width: 180, height: 180, background: "#fff", borderRadius: 10, padding: 8 }} />
              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" style={{ width: 140 }} placeholder="Код из приложения" value={totp} onChange={(e) => setTotp(e.target.value)} />
                <button className="btn sm" onClick={verify}>Подтвердить</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ fontWeight: 800, margin: "20px 0 12px" }}>Сменить пароль</div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Текущий пароль</label>
          <input className="input" type="password" value={pwd.current_password} onChange={(e) => setPwd((p) => ({ ...p, current_password: e.target.value }))} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Новый пароль (от 8 символов)</label>
          <input className="input" type="password" value={pwd.new_password} onChange={(e) => setPwd((p) => ({ ...p, new_password: e.target.value }))} />
        </div>
        <button className="btn sm" onClick={changePwd}>Сменить</button>
      </div>
    </div>
  );
}

// Редактор одного тарифа: порядок, название, цена, период, возможности, вкл/выкл, удалить.
function TariffCard({ t, onChange, onRemove, onMoveUp, onMoveDown, isFirst, isLast }) {
  const set = (k, v) => onChange({ ...t, [k]: v });
  const features = Array.isArray(t.features) ? t.features : [];
  const setFeature = (i, v) => set("features", features.map((f, idx) => (idx === i ? v : f)));
  const addFeature = () => set("features", [...features, ""]);
  const removeFeature = (i) => set("features", features.filter((_, idx) => idx !== i));

  return (
    <div className="card" style={{ marginBottom: 14, border: t.enabled === false ? "1px solid var(--border)" : "1px solid color-mix(in srgb,var(--primary) 40%,var(--border))" }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8 }}>
          {/* Перестановка: меняет порядок показа тарифов в приложении (на экране оплаты сверху вниз). */}
          <div className="row" style={{ gap: 2 }}>
            <button className="btn ghost sm" disabled={isFirst} onClick={onMoveUp} title="Поднять выше">↑</button>
            <button className="btn ghost sm" disabled={isLast} onClick={onMoveDown} title="Опустить ниже">↓</button>
          </div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{t.title || "Без названия"} {t.enabled === false
            ? <span className="pill red" style={{ marginLeft: 6 }}>выключен</span>
            : <span className="pill green" style={{ marginLeft: 6 }}>включён</span>}</div>
        </div>
        <div className="row">
          <button className="btn ghost sm" onClick={() => set("enabled", t.enabled === false)}>
            {t.enabled === false ? "Включить" : "Выключить"}
          </button>
          <button className="btn danger sm" onClick={onRemove}>Удалить</button>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="field" style={{ marginBottom: 0 }}><label>Название</label>
          <input className="input" value={t.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="PRO" /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>Цена, ₽</label>
          <input className="input" type="number" value={t.price ?? ""} onChange={(e) => set("price", Number(e.target.value))} /></div>
      </div>

      {/* Период: быстрые кнопки задают срок и подпись сразу; ниже — точная ручная настройка. */}
      <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
        <label>Период подписки</label>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {PERIOD_PRESETS.map((p) => {
            const active = Number(t.duration_days) === p.days;
            return (
              <button key={p.days} type="button" className={"btn sm " + (active ? "" : "ghost")}
                onClick={() => onChange({ ...t, duration_days: p.days, period: periodLabel(p.days) })}>
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          Кнопка ставит срок. Для нестандартного — впишите число дней ниже; подпись подставится сама.
        </div>
      </div>

      <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
        <label>Срок действия, дней</label>
        <input className="input" type="number" value={t.duration_days ?? 30}
          onChange={(e) => { const days = Number(e.target.value); onChange({ ...t, duration_days: days, period: periodLabel(days) }); }} />
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          Подпись на ценнике: «{periodLabel(t.duration_days ?? 30)}» — формируется автоматически из срока.
        </div>
      </div>

      <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
        <label>Что входит в тариф</label>
        {features.map((f, i) => (
          <div className="row" key={i} style={{ marginBottom: 8 }}>
            <input className="input" value={f} onChange={(e) => setFeature(i, e.target.value)} placeholder="Например: Безлимит сканов" />
            <button className="btn ghost sm" onClick={() => removeFeature(i)}>✕</button>
          </div>
        ))}
        <button className="btn ghost sm" onClick={addFeature}>+ Добавить пункт</button>
      </div>
    </div>
  );
}

// Вкладки страницы настроек — вместо одной длинной портянки.
const TABS = [
  { key: "tariffs", label: "Тарифы и цены" },
  { key: "limits", label: "Пробный период и лимиты" },
  { key: "texts", label: "Тексты приложения" },
  { key: "reminders", label: "Напоминания" },
  { key: "tglog", label: "Логи в Telegram" },
  { key: "security", label: "Безопасность" }
];

// Готовые периоды подписки: одна кнопка проставляет и срок (дни), и подпись сразу.
const PERIOD_PRESETS = [
  { label: "Месяц", days: 30, period: "мес" },
  { label: "3 месяца", days: 90, period: "3 мес" },
  { label: "6 месяцев", days: 180, period: "6 мес" },
  { label: "Год", days: 365, period: "год" }
];

// События, которые можно дублировать в Telegram-канал (тумблеры на вкладке «Логи в Telegram»).
const TG_LOG_EVENTS = [
  { key: "users", label: "Новые пользователи", hint: "Когда человек подписался на обязательный канал и открыл бота." },
  { key: "channel_left", label: "Вышли из канала", hint: "Когда человек отписался от обязательного канала. Нужны права админа бота в канале." },
  { key: "blocked_bot", label: "Заблокировали бота", hint: "Когда сообщение не дошло (403): человек заблокировал бота или не начинал диалог." },
  { key: "reactivation", label: "Вернулись после паузы", hint: "Когда человек снова зашёл после долгого перерыва (от 14 дней)." },
  { key: "daily_digest", label: "Ежедневная сводка", hint: "Раз в день: новые, вышли из канала, оплаты, активные, сканы за сутки." },
  { key: "payments", label: "Платежи и подписки", hint: "Оплаты, отмены, возвраты и ручная выдача подписок." },
  { key: "payment_started", label: "Начали оплату", hint: "Когда человек открыл окно оплаты ЮKassa (даже если не оплатил)." },
  { key: "subscription_renew", label: "Продления подписки", hint: "Повторная оплата теми, у кого подписка уже была." },
  { key: "subscription_expired", label: "Подписка закончилась", hint: "Когда подписка или пробный период истекли." },
  { key: "autorenew_cancel", label: "Отмена автопродления", hint: "Когда человек отключил автопродление подписки." },
  { key: "scans_photo", label: "Фото-сканы еды", hint: "Фото пользователя + что распознал AI. Может быть много сообщений." },
  { key: "errors", label: "Ошибки системы", hint: "Серверные сбои (понятным языком)." },
  { key: "support", label: "Обращения в поддержку", hint: "Новые тикеты и сообщения. Нужен токен основного бота в support/.env." },
  { key: "employees", label: "Сотрудники-пиарщики", hint: "Выдача роли, новые рефералы, их оплаты и выплаты сотрудникам." }
];

// Человеческие названия контекстов напоминаний (ключи — как в настройке reminders.texts).
const REMINDER_GROUPS = [
  { key: "paid_pre", title: "Перед окончанием платной подписки", hint: "Уходят за N дней до конца (список дней — в расписании выше)." },
  { key: "paid_post", title: "После окончания платной подписки", hint: "Серия после истечения: в день окончания и далее по расписанию." },
  { key: "trial_start", title: "Первый день пробного периода", hint: "Приветствие новичку — что доступно и сколько дней бесплатно." },
  { key: "trial_end", title: "Последний день пробного периода", hint: "Уходит в последний день бесплатного доступа." },
  { key: "trial_post", title: "После окончания пробного периода", hint: "Серия для тех, кто попробовал бесплатно и не купил." }
];

// Приёмы пищи для напоминаний (ключи — как в настройке meal_reminders.texts).
const MEAL_GROUPS = [
  { key: "breakfast", title: "Завтрак 🍳", hint: "Утреннее напоминание, если завтрак за сегодня ещё не записан." },
  { key: "lunch", title: "Обед 🥗", hint: "Дневное напоминание, если обед за сегодня ещё не записан." },
  { key: "dinner", title: "Ужин 🍽", hint: "Вечернее напоминание, если ужин за сегодня ещё не записан." }
];

// Редактор списка дней «7, 3, 1» — строка в форме, числа при сохранении.
function daysToString(v) {
  return Array.isArray(v) ? v.join(", ") : (v ?? "");
}
function parseDays(v, fallback) {
  const list = String(v ?? "").split(/[,;\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0);
  return list.length ? [...new Set(list)].sort((a, b) => a - b) : fallback;
}

// Действия с напоминаниями: боевая рассылка прямо сейчас + тест себе в Telegram.
function RemindersActions({ setMsg }) {
  const [runBusy, setRunBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testKind, setTestKind] = useState("paid_post");

  const runNow = async () => {
    const ok = window.confirm(
      "Разослать напоминания прямо сейчас?\n\n" +
      "Каждому клиенту уйдёт сообщение по его текущей ситуации: пробный период идёт / последний день / " +
      "пробный закончился / подписка скоро истечёт / подписка истекла (даже если это было давно).\n\n" +
      "Защита: не больше одного напоминания в сутки на человека — повторное нажатие сегодня никого не задвоит.\n" +
      "Несохранённые изменения на этой странице не учитываются — сначала сохраните."
    );
    if (!ok) return;
    setRunBusy(true); setMsg(null);
    try {
      const res = await Admin.runReminders();
      if (res?.disabled) setMsg("Напоминания выключены в настройках — включите и сохраните.");
      else setMsg(`Готово: отправлено ${res?.sent ?? 0}, недоступны ${res?.blocked ?? 0}${res?.failed ? `, ошибок отправки ${res.failed}` : ""}, пропущено ${res?.skipped ?? 0} (уже получали сегодня, активная подписка не скоро кончится или клиент тренера).`);
    } catch (e) {
      setMsg("Ошибка рассылки: " + (e?.response?.data?.error || e.message));
    } finally {
      setRunBusy(false);
    }
  };

  const testMe = async () => {
    setTestBusy(true); setMsg(null);
    try {
      const res = await Admin.testReminder(testKind);
      if (res?.ok) setMsg("Тест отправлен вам в Telegram — проверьте бота. Каждый клик показывает другой вариант текста.");
      else if (res?.error === "bot_not_started") setMsg("Не получилось: откройте бота и нажмите Start, затем повторите.");
      else if (res?.error === "no_templates") setMsg("Для этого типа нет ни одного текста — добавьте варианты ниже и сохраните.");
      else if (res?.error === "mock_mode") setMsg("Сервер без токена бота (mock-режим) — реальная отправка невозможна.");
      else setMsg("Не удалось отправить тест.");
    } catch (e) {
      setMsg("Ошибка теста: " + (e?.response?.data?.error || e.message));
    } finally {
      setTestBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 800, marginBottom: 12 }}>Действия</div>

      {/* Блок 1: боевая рассылка всем — одна кнопка, ничего выбирать не нужно */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Рассылка всем клиентам</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          Одна кнопка — каждому уйдёт сообщение по его ситуации: пробный период / пробный закончился /
          подписка скоро истечёт / подписка истекла. Не чаще одного напоминания в сутки на человека.
          Обычно рассылка уходит сама по вечерам — кнопка нужна, чтобы не ждать.
        </p>
        <button className="btn sm" disabled={runBusy} onClick={runNow}>
          {runBusy ? "Рассылаем…" : "📨 Разослать всем сейчас"}
        </button>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        {/* Блок 2: тест только себе — выбор типа относится ТОЛЬКО к тесту */}
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Проверка на себе</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          Пришлёт пример выбранного типа сообщения только вам в Telegram — пользователи ничего не получат.
          На рассылку всем этот выбор не влияет.
        </p>
        <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <select className="input" style={{ width: "auto" }} value={testKind} onChange={(e) => setTestKind(e.target.value)}>
            {REMINDER_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.title}</option>)}
          </select>
          <button className="btn ghost sm" disabled={testBusy} onClick={testMe}>
            {testBusy ? "Отправляем…" : "🧪 Проверить на себе"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Раздел «Напоминания о подписке»: расписание + кнопка + тексты по контекстам.
function RemindersEditor({ rem, onChange }) {
  const [open, setOpen] = useState(null); // какой блок текстов раскрыт
  const set = (k, v) => onChange({ ...rem, [k]: v });
  const texts = rem.texts && typeof rem.texts === "object" ? rem.texts : {};
  const setGroup = (key, list) => set("texts", { ...texts, [key]: list });

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Расписание</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Сообщения уходят вечером по местному времени каждого пользователя. Дни указываются через запятую.
        </p>
        <div className="kv"><span>Напоминания работают</span>
          <button className="btn ghost sm" onClick={() => set("enabled", rem.enabled === false)}>
            {rem.enabled === false ? <span className="pill red">выключены — включить</span> : <span className="pill green">включены — выключить</span>}
          </button>
        </div>
        <div className="grid cols-3" style={{ marginTop: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}><label>Час отправки (0–23, местное время)</label>
            <input className="input" type="number" min={0} max={23} value={rem.send_hour ?? 19} onChange={(e) => set("send_hour", e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>За сколько дней до конца подписки</label>
            <input className="input" value={daysToString(rem.paid_pre_days)} onChange={(e) => set("paid_pre_days", e.target.value)} placeholder="7, 3, 1" /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>Серия после окончания (0 = в день конца)</label>
            <input className="input" value={daysToString(rem.post_days)} onChange={(e) => set("post_days", e.target.value)} placeholder="0, 1, 3, 7, 14" /></div>
        </div>
        <div className="field" style={{ marginTop: 14, marginBottom: 0 }}><label>Текст кнопки под сообщением (открывает оплату)</label>
          <input className="input" value={rem.button_text ?? ""} onChange={(e) => set("button_text", e.target.value)} placeholder="Продлить подписку" /></div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Тексты сообщений</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Бот чередует варианты, чтобы не повторяться. Подстановки: {"{name}"} — имя, {"{meals_count}"} — записано приёмов пищи,
          {" {days_tracked}"} — дней с дневником, {"{weight_delta}"} — изменение веса, {"{days_left}"} — дней до конца,
          {" {expires_date}"} — дата окончания, {"{trial_days}"} — длина пробного периода.
          Если у человека нет данных для подстановки (например, не записывал вес) — такой вариант пропускается.
        </p>
        {REMINDER_GROUPS.map((g) => {
          const list = Array.isArray(texts[g.key]) ? texts[g.key] : [];
          const isOpen = open === g.key;
          return (
            <div key={g.key} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
              <button className="btn ghost sm" style={{ width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between" }}
                onClick={() => setOpen(isOpen ? null : g.key)}>
                <span style={{ fontWeight: 700 }}>{g.title}</span>
                <span className="muted">{list.length} вар. {isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div style={{ marginTop: 8 }}>
                  <p className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{g.hint}</p>
                  {list.map((t, i) => (
                    <div className="row" key={i} style={{ marginBottom: 8, alignItems: "flex-start" }}>
                      <textarea className="input" rows={2} value={t} style={{ flex: 1 }}
                        onChange={(e) => setGroup(g.key, list.map((x, idx) => (idx === i ? e.target.value : x)))} />
                      <button className="btn ghost sm" onClick={() => setGroup(g.key, list.filter((_, idx) => idx !== i))}>✕</button>
                    </div>
                  ))}
                  <button className="btn ghost sm" onClick={() => setGroup(g.key, [...list, ""])}>+ Добавить вариант</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// Кнопка «Проверить на себе» для напоминаний о еде (без боевой рассылки — они уходят сами по часам).
function MealRemindersActions({ setMsg }) {
  const [busy, setBusy] = useState(false);
  const [meal, setMeal] = useState("breakfast");
  const testMe = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await Admin.testMealReminder(meal);
      if (res?.ok) setMsg("Тест отправлен вам в Telegram — проверьте бота. Каждый клик показывает другой вариант текста.");
      else if (res?.error === "bot_not_started") setMsg("Не получилось: откройте бота и нажмите Start, затем повторите.");
      else if (res?.error === "no_templates") setMsg("Для этого приёма нет ни одного текста — добавьте варианты ниже и сохраните.");
      else if (res?.error === "mock_mode") setMsg("Сервер без токена бота (mock-режим) — реальная отправка невозможна.");
      else setMsg("Не удалось отправить тест.");
    } catch (e) {
      setMsg("Ошибка теста: " + (e?.response?.data?.error || e.message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 800, marginBottom: 4 }}>Проверка на себе</div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
        Пришлёт пример выбранного приёма только вам в Telegram — пользователи ничего не получат.
        Сами напоминания уходят по часам ниже, если приём за день не записан.
      </p>
      <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <select className="input" style={{ width: "auto" }} value={meal} onChange={(e) => setMeal(e.target.value)}>
          {MEAL_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.title}</option>)}
        </select>
        <button className="btn ghost sm" disabled={busy} onClick={testMe}>
          {busy ? "Отправляем…" : "🧪 Проверить на себе"}
        </button>
      </div>
    </div>
  );
}

// Раздел «Напоминания о еде»: вкл/выкл, часы приёмов + тексты по приёмам.
function MealRemindersEditor({ rem, onChange }) {
  const [open, setOpen] = useState(null);
  const set = (k, v) => onChange({ ...rem, [k]: v });
  const texts = rem.texts && typeof rem.texts === "object" ? rem.texts : {};
  const setGroup = (key, list) => set("texts", { ...texts, [key]: list });

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Расписание</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Часы — по местному времени каждого пользователя. Напоминание уходит, только если приём за сегодня ещё не записан.
        </p>
        <div className="kv"><span>Напоминания о еде</span>
          <button className="btn ghost sm" onClick={() => set("enabled", rem.enabled === false)}>
            {rem.enabled === false ? <span className="pill red">выключены — включить</span> : <span className="pill green">включены — выключить</span>}
          </button>
        </div>
        <div className="grid cols-3" style={{ marginTop: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}><label>Час завтрака (0–23)</label>
            <input className="input" type="number" min={0} max={23} value={rem.breakfast_hour ?? 9} onChange={(e) => set("breakfast_hour", e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>Час обеда (0–23)</label>
            <input className="input" type="number" min={0} max={23} value={rem.lunch_hour ?? 14} onChange={(e) => set("lunch_hour", e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>Час ужина (0–23)</label>
            <input className="input" type="number" min={0} max={23} value={rem.dinner_hour ?? 19} onChange={(e) => set("dinner_hour", e.target.value)} /></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Тексты сообщений</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Бот чередует варианты, чтобы не повторяться. Подстановки: {"{name}"} — имя, {"{daily_calories}"} — дневная цель,
          {" {calories_today}"} — съедено за сегодня, {"{calories_left}"} — осталось до цели, {"{streak}"} — дней подряд,
          {" {days_tracked}"} — дней с дневником, {"{meals_count}"} — всего приёмов, {"{weight_delta}"} — изменение веса.
          Если у человека нет данных для подстановки — такой вариант пропускается, поэтому оставляйте и тексты без подстановок.
        </p>
        {MEAL_GROUPS.map((g) => {
          const list = Array.isArray(texts[g.key]) ? texts[g.key] : [];
          const isOpen = open === g.key;
          return (
            <div key={g.key} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
              <button className="btn ghost sm" style={{ width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between" }}
                onClick={() => setOpen(isOpen ? null : g.key)}>
                <span style={{ fontWeight: 700 }}>{g.title}</span>
                <span className="muted">{list.length} вар. {isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div style={{ marginTop: 8 }}>
                  <p className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{g.hint}</p>
                  {list.map((t, i) => (
                    <div className="row" key={i} style={{ marginBottom: 8, alignItems: "flex-start" }}>
                      <textarea className="input" rows={2} value={t} style={{ flex: 1 }}
                        onChange={(e) => setGroup(g.key, list.map((x, idx) => (idx === i ? e.target.value : x)))} />
                      <button className="btn ghost sm" onClick={() => setGroup(g.key, list.filter((_, idx) => idx !== i))}>✕</button>
                    </div>
                  ))}
                  <button className="btn ghost sm" onClick={() => setGroup(g.key, [...list, ""])}>+ Добавить вариант</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// Раздел «Логи в Telegram»: куда и какие события дублировать + интервал автообновления админки.
function TgLogEditor({ form, setVal }) {
  const events = (form.tg_log_events && typeof form.tg_log_events === "object") ? form.tg_log_events : {};
  const setEvent = (k, v) => setVal("tg_log_events", { ...events, [k]: v });
  const enabled = form.tg_log_enabled !== false;
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Куда дублировать</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Бот шлёт копии событий в Telegram-канал. Основной бот (Bytwise) должен быть админом этого канала.
          ID канала — вида <code>-100…</code>.
        </p>
        <div className="kv"><span>Дублирование в канал</span>
          <button className="btn ghost sm" onClick={() => setVal("tg_log_enabled", !enabled)}>
            {enabled ? <span className="pill green">включено — выключить</span> : <span className="pill red">выключено — включить</span>}
          </button>
        </div>
        <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
          <label>ID канала</label>
          <input className="input" value={form.tg_log_channel_id ?? ""} onChange={(e) => setVal("tg_log_channel_id", e.target.value)} placeholder="-1004283676399" />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Какие события</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Включайте только нужное, чтобы канал не засорялся.</p>
        {TG_LOG_EVENTS.map((ev) => {
          const on = events[ev.key] !== false;
          return (
            <div key={ev.key} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
              <div className="kv" style={{ alignItems: "flex-start", gap: 12 }}>
                <span style={{ fontWeight: 700 }}>{ev.label}<br />
                  <span className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>{ev.hint}</span>
                </span>
                <button className="btn ghost sm" onClick={() => setEvent(ev.key, !on)}>
                  {on ? <span className="pill green">вкл</span> : <span className="pill red">выкл</span>}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Автообновление админки</div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
          Как часто страницы админки сами подтягивают свежие данные (в секундах). 0 — выключить автообновление.
        </p>
        <div className="field" style={{ marginBottom: 0, maxWidth: 220 }}>
          <label>Интервал, сек</label>
          <input className="input" type="number" min={0} value={form.admin_live_refresh_sec ?? 10}
            onChange={(e) => setVal("admin_live_refresh_sec", e.target.value)} />
        </div>
      </div>
    </>
  );
}

export default function SettingsPage() {
  const { data, loading, setData } = useFetch(Admin.getSettings, []);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("tariffs");

  useEffect(() => {
    if (data?.settings) {
      const s = data.settings;
      setForm({
        ...s,
        tariffs: Array.isArray(s.tariffs) ? s.tariffs : [],
        reminders: s.reminders && typeof s.reminders === "object" ? s.reminders : {},
        meal_reminders: s.meal_reminders && typeof s.meal_reminders === "object" ? s.meal_reminders : {}
      });
    }
  }, [data]);

  if (loading || !form) return <Loader />;

  const setVal = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // --- Тарифы ---
  const tariffs = Array.isArray(form.tariffs) ? form.tariffs : [];
  const setTariffs = (list) => setVal("tariffs", list);
  const updateTariff = (i, next) => setTariffs(tariffs.map((t, idx) => (idx === i ? next : t)));
  const removeTariff = (i) => setTariffs(tariffs.filter((_, idx) => idx !== i));
  // Перестановка: меняет порядок в массиве — он же порядок показа на экране оплаты.
  const moveTariff = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= tariffs.length) return;
    const next = tariffs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setTariffs(next);
  };
  const addTariff = () => setTariffs([...tariffs, {
    id: "plan_" + Date.now(), title: "Новый тариф", price: 349, period: "мес", duration_days: 30, enabled: true, features: []
  }]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      // Чистим тарифы: убираем пустые пункты, гарантируем числа и id.
      const cleanTariffs = tariffs.map((t) => ({
        id: t.id || ("plan_" + Math.random().toString(36).slice(2, 8)),
        title: (t.title || "").trim() || "Тариф",
        price: Number(t.price) || 0,
        duration_days: Number(t.duration_days) > 0 ? Number(t.duration_days) : 30,
        period: periodLabel(Number(t.duration_days) > 0 ? Number(t.duration_days) : 30),
        enabled: t.enabled !== false,
        features: (Array.isArray(t.features) ? t.features : []).map((f) => f.trim()).filter(Boolean)
      }));
      // Чистим напоминания: списки дней из строк в числа, пустые тексты убираем.
      const rem = form.reminders || {};
      const remTexts = rem.texts && typeof rem.texts === "object" ? rem.texts : {};
      const cleanTexts = {};
      for (const g of REMINDER_GROUPS) {
        cleanTexts[g.key] = (Array.isArray(remTexts[g.key]) ? remTexts[g.key] : []).map((t) => String(t).trim()).filter(Boolean);
      }
      // Час: 0 (полночь) — валидное значение, поэтому без `|| 19` (0 — falsy).
      const hourRaw = String(rem.send_hour ?? "").trim();
      const hour = Number(hourRaw);
      const cleanReminders = {
        enabled: rem.enabled !== false,
        send_hour: hourRaw !== "" && Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 19,
        paid_pre_days: parseDays(rem.paid_pre_days, [7, 3, 1]),
        post_days: parseDays(rem.post_days, [0, 1, 3, 7, 14]),
        button_text: (rem.button_text || "").trim() || "Продлить подписку",
        texts: cleanTexts
      };
      // Чистим напоминания о еде: пустые тексты убираем, часы валидируем (0–23).
      const meal = form.meal_reminders || {};
      const mealTexts = meal.texts && typeof meal.texts === "object" ? meal.texts : {};
      const cleanMealTexts = {};
      for (const g of MEAL_GROUPS) {
        cleanMealTexts[g.key] = (Array.isArray(mealTexts[g.key]) ? mealTexts[g.key] : []).map((t) => String(t).trim()).filter(Boolean);
      }
      const mealHour = (v, d) => { const n = Number(String(v ?? "").trim()); return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d; };
      const cleanMealReminders = {
        enabled: meal.enabled !== false,
        breakfast_hour: mealHour(meal.breakfast_hour, 9),
        lunch_hour: mealHour(meal.lunch_hour, 14),
        dinner_hour: mealHour(meal.dinner_hour, 19),
        texts: cleanMealTexts
      };
      const payload = {
        free_scan_daily_limit: Number(form.free_scan_daily_limit),
        trial_days: Number(form.trial_days),
        trainer_max_clients: Number(form.trainer_max_clients),
        welcome_text: form.welcome_text,
        paywall_text: form.paywall_text,
        tariffs: cleanTariffs,
        support_links: typeof form.support_links === "string" ? JSON.parse(form.support_links) : form.support_links,
        reminders: cleanReminders,
        meal_reminders: cleanMealReminders,
        // Логи в Telegram + интервал автообновления админки.
        tg_log_enabled: form.tg_log_enabled !== false,
        tg_log_channel_id: String(form.tg_log_channel_id ?? "").trim(),
        tg_log_events: (form.tg_log_events && typeof form.tg_log_events === "object") ? form.tg_log_events : {},
        admin_live_refresh_sec: Math.max(0, Math.round(Number(form.admin_live_refresh_sec)) || 0)
      };
      const res = await Admin.saveSettings(payload);
      setData(res);
      if (res?.settings) setForm({
        ...res.settings,
        tariffs: Array.isArray(res.settings.tariffs) ? res.settings.tariffs : [],
        reminders: res.settings.reminders && typeof res.settings.reminders === "object" ? res.settings.reminders : {},
        meal_reminders: res.settings.meal_reminders && typeof res.settings.meal_reminders === "object" ? res.settings.meal_reminders : {}
      });
      setMsg("Настройки сохранены — цены и подписки обновлены в приложении");
    } catch (e) {
      setMsg("Ошибка: " + (e?.response?.data?.error || e.message));
    } finally {
      setBusy(false);
    }
  };

  const numField = (k, label) => (
    <div className="field"><label>{label}</label>
      <input className="input" type="number" value={form[k] ?? ""} onChange={(e) => setVal(k, e.target.value)} /></div>
  );
  const textField = (k, label) => (
    <div className="field"><label>{label}</label>
      <textarea className="input" rows={2} value={form[k] ?? ""} onChange={(e) => setVal(k, e.target.value)} /></div>
  );
  // support_links — объект { help, privacy, terms }. Редактируем как обычные ссылки.
  const links = (form.support_links && typeof form.support_links === "object") ? form.support_links : {};
  const setLink = (k, v) => setVal("support_links", { ...links, [k]: v });
  const linkField = (k, label) => (
    <div className="field"><label>{label}</label>
      <input className="input" value={links[k] ?? ""} onChange={(e) => setLink(k, e.target.value)} placeholder="https://…" /></div>
  );

  const saveBtn = (
    <button className="btn" disabled={busy} onClick={save} style={{ marginBottom: 8 }}>
      {busy ? "Сохранение…" : "Сохранить настройки"}
    </button>
  );

  return (
    <div>
      <div className="topbar"><h1 className="page-title">Настройки</h1></div>

      {/* Вкладки (паттерн периодов из «Денег»): открыта одна секция, ничего лишнего */}
      <div className="row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.key} className={"btn sm " + (tab === t.key ? "" : "ghost")} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {msg && <div className="err" style={{ background: "color-mix(in srgb,var(--green) 16%,transparent)", color: "#7ee2a8" }}>{msg}</div>}

      {tab === "tariffs" && (
        <>
          <p className="muted" style={{ marginBottom: 14, fontSize: 13.5 }}>
            Цена, срок и состав подписок. Изменения применяются сразу — и в приложении, и при оплате.
            Выключенный тариф пропадает из приложения, но активные подписки не отменяются.
          </p>
          {tariffs.map((t, i) => (
            <TariffCard key={t.id || i} t={t} onChange={(next) => updateTariff(i, next)} onRemove={() => removeTariff(i)}
              onMoveUp={() => moveTariff(i, -1)} onMoveDown={() => moveTariff(i, 1)}
              isFirst={i === 0} isLast={i === tariffs.length - 1} />
          ))}
          {!tariffs.length && <div className="card muted" style={{ marginBottom: 14 }}>Тарифов пока нет. Добавьте первый.</div>}
          <div className="row" style={{ marginBottom: 8 }}>
            <button className="btn ghost" onClick={addTariff}>+ Добавить тариф</button>
            {saveBtn}
          </div>
        </>
      )}

      {tab === "limits" && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="grid cols-2">
              {numField("free_scan_daily_limit", "Бесплатных распознаваний в день")}
              {numField("trial_days", "Длительность пробного периода, дней")}
              {numField("trainer_max_clients", "Максимум клиентов у тренера")}
            </div>
          </div>
          {saveBtn}
        </>
      )}

      {tab === "texts" && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            {textField("welcome_text", "Приветственное сообщение")}
            {textField("paywall_text", "Текст на экране оплаты")}
            <div className="grid cols-3" style={{ marginTop: 4 }}>
              {linkField("help", "Ссылка на поддержку")}
              {linkField("privacy", "Политика конфиденциальности")}
              {linkField("terms", "Условия использования")}
            </div>
          </div>
          {saveBtn}
        </>
      )}

      {tab === "reminders" && (
        <>
          <p className="muted" style={{ marginBottom: 14, fontSize: 13.5 }}>
            Бот напоминает о подписке и пробном периоде: заранее, в день окончания и после.
            Эти сообщения приходят даже тем, кто выключил обычные уведомления.
          </p>
          <RemindersActions setMsg={setMsg} />
          <RemindersEditor rem={form.reminders || {}} onChange={(next) => setVal("reminders", next)} />

          <div style={{ height: 1, background: "var(--border)", margin: "22px 0" }} />
          <h3 style={{ fontWeight: 800, marginBottom: 6 }}>Напоминания о еде</h3>
          <p className="muted" style={{ marginBottom: 14, fontSize: 13.5 }}>
            Бот напоминает записать завтрак, обед и ужин по часам ниже — только если приём за день ещё не отмечен.
            Эти сообщения уважают переключатель обычных уведомлений у пользователя.
          </p>
          <MealRemindersActions setMsg={setMsg} />
          <MealRemindersEditor rem={form.meal_reminders || {}} onChange={(next) => setVal("meal_reminders", next)} />
          {saveBtn}
        </>
      )}

      {tab === "tglog" && (
        <>
          <p className="muted" style={{ marginBottom: 14, fontSize: 13.5 }}>
            Дублирование событий в Telegram-канал и частота автообновления данных в админке.
            Всё применяется сразу после сохранения.
          </p>
          <TgLogEditor form={form} setVal={setVal} />
          {saveBtn}
        </>
      )}

      {tab === "security" && <Security />}
    </div>
  );
}
