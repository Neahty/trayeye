import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Admin } from "./api";

// useFetch(fn, deps, { intervalMs }) — загрузка данных + опциональное тихое автообновление.
// «Тихий» reload не трогает loading, поэтому данные обновляются без мигания спиннера.
export function useFetch(fn, deps = [], opts = {}) {
  const { intervalMs = 0 } = opts;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const run = useCallback((silent) => {
    if (!silent) setLoading(true);
    return fn()
      .then((d) => { setData(d); setError(null); setLastUpdated(Date.now()); })
      .catch((e) => setError(e?.response?.data?.error || e.message))
      .finally(() => { if (!silent) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const reload = useCallback(() => run(false), [run]);
  useEffect(() => { run(false); }, [run]);
  // Автообновление: тихий перезапрос по интервалу; на скрытой вкладке сервер не дёргаем.
  useEffect(() => {
    if (!intervalMs) return undefined;
    const id = setInterval(() => { if (!document.hidden) run(true); }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, run]);
  return { data, loading, error, reload, setData, lastUpdated };
}

// Глобальное автообновление админки: интервал из настроек (admin_live_refresh_sec),
// с возможностью паузы. Оборачивает авторизованную часть приложения.
const LiveCtx = createContext({ intervalMs: 0, paused: false, refreshSec: 0, togglePaused: () => {} });
export const useLive = () => useContext(LiveCtx);

export function LiveProvider({ children }) {
  const [refreshSec, setRefreshSec] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    Admin.getSettings()
      .then((d) => {
        const s = Number(d?.settings?.admin_live_refresh_sec);
        setRefreshSec(Number.isFinite(s) && s >= 0 ? s : 10);
      })
      .catch(() => setRefreshSec(10));
  }, []);
  // Минимум 3 секунды, чтобы не молотить сервер; 0 в настройках — автообновление выключено.
  const intervalMs = paused || !refreshSec ? 0 : Math.max(3, refreshSec) * 1000;
  const value = { intervalMs, paused, refreshSec, togglePaused: () => setPaused((p) => !p) };
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

export function Stat({ label, value, sub }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Loader() {
  return <div className="loading"><div className="spinner" /></div>;
}

export function money(n) {
  return (Number(n) || 0).toLocaleString("ru-RU") + " ₽";
}

// Загружает тарифы из настроек и отдаёт карту { id: тариф } — для названий и цен
// в списках/диалогах. Грузится один раз на странице.
export function useTariffMap() {
  const [map, setMap] = useState({});
  useEffect(() => {
    Admin.getSettings()
      .then((d) => {
        const list = d?.settings?.tariffs;
        const m = {};
        if (Array.isArray(list)) for (const t of list) if (t?.id) m[t.id] = t;
        setMap(m);
      })
      .catch(() => {});
  }, []);
  return map;
}

// Название тарифа. Сначала — реальное название из настроек (динамически), затем запасные
// варианты для встроенных типов, если настройки ещё не загрузились.
export function subLabel(type, map) {
  const title = map && map[type] && map[type].title;
  if (title) return title;
  if (type === "trainer") return "Тренерская";
  if (type === "basic" || type === "pro") return "PRO";
  return type || "—";
}

// Спрашивает админа, добавлять ли деньги в выручку при ручной выдаче подписки.
// Возвращает тело для Admin.grantSub: { type, days, record_payment, amount? }.
// Если выдачу отменили (Esc на первом вопросе) — вернёт null.
export function askGrantBody(type, days = 30, priceHint) {
  // Цена-подсказка берётся из тарифа (динамически); запасной вариант — если настройки недоступны.
  const defaultPrice = Number(priceHint) > 0 ? Math.round(Number(priceHint)) : (type === "trainer" ? 1799 : 349);
  const add = window.confirm(
    "Добавить деньги в выручку (создать платёж)?\n\n" +
    "OK — да, оплата пришла мимо кассы, учесть её.\n" +
    "Отмена — нет, выдать бесплатно."
  );
  if (!add) return { type, days, record_payment: false };
  const raw = window.prompt("Сумма платежа, ₽", String(defaultPrice));
  if (raw === null) return { type, days, record_payment: false }; // передумал про деньги — выдаём без денег
  const amount = Math.round(Number(raw)) || defaultPrice;
  return { type, days, record_payment: true, amount };
}

// Готовые сроки выдачи подписки и тарифов: дни → подпись. Одна точка правды для админки.
export const GRANT_PERIODS = [
  { label: "Месяц", days: 30 },
  { label: "3 мес", days: 90 },
  { label: "Полгода", days: 180 },
  { label: "Год", days: 365 }
];

// Подпись периода по сроку в днях (для тарифов и выдачи): 30→«мес», 365→«год» и т.д.
export function periodLabel(days) {
  const d = Number(days);
  if (d === 30) return "мес";
  if (d === 90) return "3 мес";
  if (d === 180) return "6 мес";
  if (d === 365) return "год";
  return `${d > 0 ? d : 0} дн`;
}

// Всё время в админке показываем в МСК+2 (UTC+5, без перехода на летнее время).
const ADMIN_TZ = "Asia/Yekaterinburg";

export function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: ADMIN_TZ }); }
  catch { return String(d); }
}

export function fmtDay(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", timeZone: ADMIN_TZ }); }
  catch { return String(d); }
}
