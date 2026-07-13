import { useState } from "react";
import WebApp from "@twa-dev/sdk";
import { Membership } from "../api";
import { Ic } from "../components/icons";

export default function SubscribeGate({ channelUrl, onSubscribed }) {
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState(false);

  const openChannel = () => {
    if (!channelUrl) return;
    try { WebApp.openTelegramLink(channelUrl); }
    catch { window.open(channelUrl, "_blank"); }
  };

  const recheck = async () => {
    setChecking(true);
    setErr(false);
    try {
      const r = await Membership.status(true);
      if (r.subscribed) onSubscribed?.();
      else setErr(true);
    } catch {
      setErr(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="screen fade-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "80vh", textAlign: "center", gap: 18, padding: "0 8px" }}>
      <div style={{ width: 88, height: 88, borderRadius: "50%", background: "var(--grad)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 14px 32px -10px var(--primary)" }}>
        <Ic name="shield" size={42} sw={1.7} style={{ color: "#fff" }} />
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Подпишитесь на канал</h1>
      <p style={{ fontSize: 16, lineHeight: 1.55, color: "var(--text-2)", margin: 0, maxWidth: 320 }}>
        Чтобы пользоваться ботом, подпишитесь на наш канал. После подписки нажмите «Я подписался».
      </p>
      {err && (
        <div style={{ fontSize: 14.5, color: "var(--red, #EF4444)", fontWeight: 600 }}>
          Подписка не найдена. Подпишитесь и попробуйте снова.
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 320, marginTop: 6 }}>
        <button className="sheet-btn" onClick={openChannel} disabled={!channelUrl}>Подписаться на канал</button>
        <button className="sheet-btn ghost" onClick={recheck} disabled={checking}>
          {checking ? "Проверяем…" : "Я подписался"}
        </button>
      </div>
    </div>
  );
}
