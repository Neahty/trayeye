import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Subscription, Settings } from "../api";
import { useApp } from "../AppContext";
import { useUI } from "../ui/UIProvider";
import { Ic } from "../components/icons";

export default function BecomeTrainer() {
  const navigate = useNavigate();
  const { reload } = useApp();
  const ui = useUI();
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { Settings.public().then(setCfg).catch(() => setCfg(null)); }, []);

  // Тренерский тариф из настроек (если выключен админом — покажем заглушку).
  const plan = cfg?.tariffs?.find((t) => t.id === "trainer");

  async function buy() {
    setLoading(true);
    try {
      const res = await Subscription.buy("trainer");
      if (res?.activated) {
        await reload();
        ui.toast("Тренерская подписка активна", "check");
        navigate("/trainer");
        return;
      }
      if (res?.payment_url) window.location.href = res.payment_url;
      else setLoading(false);
    } catch (e) {
      const err = e?.response?.data?.error;
      if (err === "already_subscribed") {
        ui.toast("У вас уже есть активная подписка");
        await reload();
        navigate("/");
      } else if (err === "tariff_disabled") {
        ui.toast("Тренерский тариф сейчас недоступен");
        setLoading(false);
      } else {
        ui.toast("Не удалось оформить подписку");
        setLoading(false);
      }
    }
  }

  const features = plan?.features?.length
    ? plan.features
    : ["До 20 клиентов", "Цели КБЖУ клиентам", "Контроль питания клиентов", "Комментарии к приёмам пищи"];

  return (
    <div className="screen fade-in" style={{ paddingTop: 20 }}>
      <button className="tap" onClick={() => navigate(-1)} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)", marginBottom: 14, fontWeight: 600 }}>
        <Ic name="chevronRight" size={18} sw={2.2} style={{ transform: "rotate(180deg)" }} /> Назад
      </button>

      <div style={{ textAlign: "center", marginBottom: 22 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--grad)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 14px 30px -8px var(--primary)" }}>
          <Ic name="weight" size={34} sw={1.7} style={{ color: "#fff" }} />
        </div>
        <h1 className="h-title" style={{ fontSize: 25 }}>{plan?.title || "Тренер"}</h1>
        <p className="muted" style={{ fontSize: 15.5, marginTop: 8, lineHeight: 1.5 }}>
          Ведите клиентов: задавайте им КБЖУ, следите за питанием и давайте обратную связь.
        </p>
      </div>

      <div className="card" style={{ padding: 20, border: "2px solid var(--primary)" }}>
        <div className="row-between">
          <div style={{ fontWeight: 800, fontSize: 19 }}>{plan?.title || "Тренер"}</div>
          <div>
            <span style={{ fontSize: 24, fontWeight: 800, color: "var(--primary)" }}>{plan?.price ?? "—"} ₽</span>
            <span style={{ color: "var(--text-2)", fontWeight: 600 }}>/{plan?.period || "мес"}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "14px 0 16px" }}>
          {features.map((f) => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 15 }}>
              <span style={{ color: "var(--green-ink)" }}><Ic name="check" size={18} sw={2.4} /></span> {f}
            </div>
          ))}
        </div>
        <button className="sheet-btn" disabled={loading || !plan} onClick={buy}>
          {loading ? "Открываем оплату…" : plan ? "Стать тренером" : "Недоступно"}
        </button>
      </div>

      <button className="sheet-btn ghost" style={{ marginTop: 18 }} onClick={() => navigate("/")}>Позже</button>
    </div>
  );
}
