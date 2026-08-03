import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Subscription, Settings } from "../api";
import { useApp } from "../AppContext";
import { useUI } from "../ui/UIProvider";
import { Ic } from "../components/icons";
import { openPayment } from "../lib/tg";

export default function Paywall() {
  const navigate = useNavigate();
  const { profile, reload } = useApp();
  const ui = useUI();
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { Settings.public().then(setCfg).catch(() => setCfg(null)); }, []);

  // Если доступ уже есть (своя активная подписка или доступ от тренера) — пейволл не нужен:
  // ведём в «Управление подпиской». Активный пробный период не редиректим — это апселл.
  const hasAccess = Boolean(profile?.subscription || profile?.trainer);
  useEffect(() => {
    if (hasAccess) navigate("/subscription", { replace: true });
  }, [hasAccess, navigate]);

  async function buy(type) {
    setLoading(true);
    try {
      const res = await Subscription.buy(type);
      // Mock-режим: подписка активирована на сервере — без редиректа.
      if (res?.activated) {
        await reload();
        ui.toast("Подписка активна", "check");
        navigate("/");
        return;
      }
      openPayment(ui, res?.payment_url || res?.mock);
      setLoading(false);
    } catch (e) {
      if (e?.response?.data?.error === "already_subscribed") {
        const until = e.response.data.expires_at
          ? new Date(e.response.data.expires_at).toLocaleDateString("ru-RU") : null;
        ui.toast(until ? `Подписка уже активна до ${until}` : "Подписка уже активна", "check");
        await reload();
        navigate("/");
      } else {
        ui.toast("Не удалось оформить подписку");
      }
      setLoading(false);
    }
  }

  // Запасной тариф на случай, если настройки не загрузились (цена — из настроек).
  const defaultTariffs = [
    { id: "basic", title: "PRO", price: cfg?.price_basic || 349, period: "мес", features: ["Безлимит сканов", "AI-добавление текстом", "Полная статистика"] }
  ];
  // Сервер уже отдаёт только включённые тарифы — показываем все, включая тренерский
  // (его также можно купить через «Стать тренером» в Профиле).
  const tariffs = cfg?.tariffs?.length ? cfg.tariffs : defaultTariffs;

  // Подзаголовок по ситуации (доступа нет, иначе был бы редирект выше):
  //  — была платная подписка и закончилась → «Подписка закончилась»;
  //  — платной не было, но пробный истёк → «Пробный период закончился»;
  //  — пробный ещё идёт → нейтральное предложение (текст из настроек).
  // {limit} в текстах оффера → дневной лимит бесплатных сканов из настроек.
  const freeLimit = cfg?.free_scan_daily_limit;
  const fillLimit = (s) => String(s || "").replace(/\{limit\}/g, freeLimit != null ? freeLimit : "");

  const subtitle = profile?.last_subscription
    ? "Подписка закончилась. Продлите Bytwise PRO, чтобы вернуть безлимит и статистику."
    : !profile?.trial?.active
    ? "Пробный период закончился. Оформите Bytwise PRO, чтобы продолжать считать калории без ограничений."
    : fillLimit(cfg?.paywall_text || "Безлимитное сканирование, AI-добавление текстом и полная статистика.");

  // Заметный оффер-блок: буллеты преимуществ Pro (редактируются в админке).
  const offerFeatures = Array.isArray(cfg?.paywall_features) ? cfg.paywall_features.filter(Boolean) : [];

  if (hasAccess) return null; // пока выполняется редирект — пейволл не показываем

  return (
    <div className="screen fade-in" style={{ paddingTop: 28 }}>
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--grad)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 14px 30px -8px var(--primary)" }}>
          <Ic name="crown" size={36} sw={1.7} style={{ color: "#fff" }} />
        </div>
        <h1 className="h-title" style={{ fontSize: 26 }}>Bytwise PRO</h1>
        <p className="muted" style={{ fontSize: 15.5, marginTop: 8, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      </div>

      {offerFeatures.length > 0 && (
        <div style={{ background: "var(--grad)", borderRadius: 18, padding: "18px 20px", marginBottom: 18, color: "#fff", boxShadow: "0 16px 34px -12px var(--primary)" }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>С Bytwise PRO вам доступно:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {offerFeatures.map((f) => (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15.5, fontWeight: 600 }}>
                <span style={{ display: "inline-flex", width: 22, height: 22, flex: "0 0 22px", borderRadius: "50%", background: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" }}>
                  <Ic name="check" size={15} sw={2.6} style={{ color: "#fff" }} />
                </span> {fillLimit(f)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {tariffs.map((t, i) => (
          <div key={t.id} className="card" style={{ padding: 20, border: i === 0 ? "2px solid var(--primary)" : undefined }}>
            <div className="row-between">
              <div style={{ fontWeight: 800, fontSize: 19 }}>{t.title}</div>
              <div>
                <span style={{ fontSize: 24, fontWeight: 800, color: "var(--primary)" }}>{t.price} ₽</span>
                <span style={{ color: "var(--text-2)", fontWeight: 600 }}>/{t.period || "мес"}</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "14px 0 16px" }}>
              {(t.features || []).map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 15 }}>
                  <span style={{ color: "var(--green-ink)" }}><Ic name="check" size={18} sw={2.4} /></span> {f}
                </div>
              ))}
            </div>
            <button className="sheet-btn" disabled={loading} onClick={() => buy(t.id)}>
              {loading ? "Открываем оплату…" : `Оформить ${t.title}`}
            </button>
          </div>
        ))}
      </div>

      <button className="sheet-btn ghost" style={{ marginTop: 18 }} onClick={() => navigate("/")}>Позже</button>

      <p style={{ textAlign: "center", fontSize: 12.5, color: "var(--text-3)", marginTop: 14, lineHeight: 1.6 }}>
        Оформляя подписку, вы соглашаетесь с{" "}
        <a href="https://docs.google.com/document/d/1FbrKM_SqWh1lTQ3Rq8kkO3DNu2p5M4ARoPeICQq8fAw/edit?usp=sharing" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>Условиями использования</a>
        {" "}и{" "}
        <a href="https://docs.google.com/document/d/15UlEfRYqYLtvNtGVXJ_ZhnHLTmLJe_z7g9oukD648Bg/edit?usp=sharing" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>Политикой конфиденциальности</a>
      </p>
    </div>
  );
}
