import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Subscription, Settings } from "../api";
import { useApp } from "../AppContext";
import { useUI } from "../ui/UIProvider";
import { Ic } from "../components/icons";
import { subName } from "../lib/sub";
import { openPayment } from "../lib/openExternal";

const PAY_STATUS = {
  succeeded: { label: "Оплачено", color: "var(--green-ink)" },
  pending: { label: "Ожидает оплаты", color: "var(--text-2)" },
  refunded: { label: "Возврат", color: "var(--text-2)" },
  cancelled: { label: "Отменён", color: "var(--text-3)" },
  error: { label: "Ошибка", color: "var(--red)" }
};

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("ru-RU") : "-";
}

// Сколько дней осталось до даты (целое, не меньше 0).
function daysLeft(dateStr) {
  if (!dateStr) return null;
  const ms = new Date(dateStr) - new Date();
  return Math.max(0, Math.ceil(ms / 86400000));
}

export default function ManageSubscription() {
  const navigate = useNavigate();
  const { profile, reload } = useApp();
  const ui = useUI();
  const [cfg, setCfg] = useState(null);
  const [pays, setPays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Тарифы и история платежей грузятся вместе; при сбое сети показываем заметное
  // сообщение с кнопкой «Повторить» - раньше страница молча оставалась пустой.
  async function loadData() {
    setLoadFailed(false);
    try {
      const [c, p] = await Promise.all([Settings.public(), Subscription.payments()]);
      setCfg(c);
      setPays(p.payments || []);
    } catch {
      setLoadFailed(true);
    }
  }
  useEffect(() => { loadData(); }, []);

  const sub = profile?.subscription;
  const trial = profile?.trial;
  const trainer = profile?.trainer; // доступ от тренера (клиент тренера без своей подписки)
  const endDate = sub ? sub.expires_at : (trial?.active ? trial.ends_at : null);
  const left = daysLeft(endDate);

  // Прогресс срока платной подписки: от начала до окончания.
  let progress = null;
  if (sub?.started_at && sub?.expires_at) {
    const start = new Date(sub.started_at).getTime();
    const end = new Date(sub.expires_at).getTime();
    progress = end > start ? Math.min(100, Math.max(0, ((Date.now() - start) / (end - start)) * 100)) : null;
  }

  // Какие тарифы предложить: триал/без подписки - любые; basic - апгрейд до тренерской; тренер - максимум.
  const allTariffs = cfg?.tariffs || [];
  let upgradeOptions = [];
  if (!sub) upgradeOptions = allTariffs;
  else if (sub.type === "basic") upgradeOptions = allTariffs.filter((t) => t.id === "trainer");

  const helpLink = cfg?.support_links?.help;

  async function buy(type) {
    setLoading(true);
    try {
      const res = await Subscription.buy(type);
      if (res?.activated) { await reload(); ui.toast("Подписка активна", "check"); navigate("/"); return; }
      openPayment(ui, res?.payment_url || res?.mock);
      setLoading(false);
    } catch (e) {
      const err = e?.response?.data?.error;
      if (err === "already_subscribed") { ui.toast("Подписка уже активна", "check"); await reload(); }
      else ui.toast("Не удалось оформить подписку");
      setLoading(false);
    }
  }

  return (
    <div className="screen fade-in">
      <button className="tap" onClick={() => navigate("/profile")} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)", marginBottom: 8, fontWeight: 600 }}>
        <Ic name="chevronRight" size={18} sw={2.2} style={{ transform: "rotate(180deg)" }} /> Профиль
      </button>
      <h1 className="h-title" style={{ marginBottom: 14 }}>Управление подпиской</h1>

      {/* Статус */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--grad)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 56px", boxShadow: "0 8px 18px -6px var(--primary)" }}>
            <Ic name="crown" size={28} sw={1.7} style={{ color: "#fff" }} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{sub ? subName(sub.type) : (trial?.active ? "Пробный период" : trainer ? "Доступ от тренера" : "Bytwise Free")}</div>
            <div style={{ fontSize: 13.5, color: "var(--text-2)", marginTop: 2 }}>
              {sub ? "Подписка активна" : trial?.active ? "Бесплатный доступ" : trainer ? "Доступ открыт тренером" : "Подписки нет"}
            </div>
          </div>
        </div>

        {endDate && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ color: "var(--text-2)", fontSize: 14 }}>Действует до {fmtDate(endDate)}</span>
              <span style={{ fontWeight: 800, fontSize: 18, color: "var(--primary)" }}>{left} дн.</span>
            </div>
            {progress != null && (
              <div style={{ height: 8, borderRadius: 6, background: "var(--track)", overflow: "hidden" }}>
                <div style={{ width: `${progress}%`, height: "100%", background: "var(--grad)", borderRadius: 6, transition: "width .4s" }} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Сбой загрузки тарифов/платежей - без этого при плохой сети страница выглядела пустой */}
      {loadFailed && (
        <div className="card" style={{ marginTop: 18, padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 14.5, color: "var(--text-2)", marginBottom: 12 }}>
            Не удалось загрузить тарифы и историю платежей. Проверьте интернет и попробуйте ещё раз.
          </div>
          <button className="sheet-btn ghost" onClick={loadData}>Повторить</button>
        </div>
      )}

      {/* Смена / улучшение тарифа */}
      {upgradeOptions.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 800, margin: "0 4px 10px" }}>
            {sub ? "Улучшить тариф" : "Оформить подписку"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {upgradeOptions.map((t) => (
              <div key={t.id} className="card" style={{ padding: 18 }}>
                <div className="row-between">
                  <div style={{ fontWeight: 800, fontSize: 17 }}>{t.title}</div>
                  <div>
                    <span style={{ fontSize: 22, fontWeight: 800, color: "var(--primary)" }}>{t.price} ₽</span>
                    <span style={{ color: "var(--text-2)", fontWeight: 600 }}>/{t.period || "мес"}</span>
                  </div>
                </div>
                {(t.features || []).length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, margin: "12px 0 14px" }}>
                    {t.features.map((f) => (
                      <div key={f} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14.5 }}>
                        <span style={{ color: "var(--green-ink)" }}><Ic name="check" size={17} sw={2.4} /></span> {f}
                      </div>
                    ))}
                  </div>
                )}
                <button className="sheet-btn" disabled={loading} onClick={() => buy(t.id)}>
                  {loading ? "Открываем оплату…" : (sub ? `Перейти на ${t.title}` : `Оформить ${t.title}`)}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {sub?.type === "trainer" && (
        <div className="card" style={{ marginTop: 18, padding: 16, color: "var(--text-2)", fontSize: 14.5 }}>
          👑 У вас максимальный тариф - Тренерская подписка.
        </div>
      )}

      {/* История платежей */}
      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 18, fontWeight: 800, margin: "0 4px 10px" }}>История платежей</div>
        <div className="card" style={{ padding: pays.length ? "4px 0" : 16 }}>
          {pays.length ? pays.map((p, i) => {
            const st = PAY_STATUS[p.status] || { label: p.status, color: "var(--text-2)" };
            return (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: i < pays.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{fmtDate(p.created_at)}</div>
                  <div style={{ fontSize: 12.5, color: st.color, marginTop: 2 }}>{st.label}{p.sub_type ? ` · ${subName(p.sub_type)}` : ""}</div>
                </div>
                <div style={{ fontWeight: 800 }}>{Number(p.amount) || 0} ₽</div>
              </div>
            );
          }) : <span className="muted" style={{ fontSize: 14 }}>{loadFailed ? "Не удалось загрузить историю." : "Платежей пока нет."}</span>}
        </div>
      </div>

      {helpLink && (
        <button className="sheet-btn ghost" style={{ marginTop: 18 }} onClick={() => window.open(helpLink, "_blank")}>
          Написать в поддержку
        </button>
      )}
    </div>
  );
}
