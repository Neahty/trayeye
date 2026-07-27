// Экран «Пригласить друга»: личная короткая ссылка, шаринг и своя статистика.
// Ссылка ведёт в бота (?start=<code>), а не в мини-апп: так друг проходит /start
// с проверкой подписки на канал, и только тогда приглашение попадает в учёт.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import WebApp from "@twa-dev/sdk";
import { Invite } from "../api";
import { useUI } from "../ui/UIProvider";
import { Ic } from "../components/icons";

// Плитка с цифрой: одинаковая высота у всех, подпись в две строки не ломает сетку.
function StatTile({ value, label, accent }) {
  return (
    <div className="card" style={{ padding: "14px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.5px", color: accent || "var(--text)" }}>{value}</div>
      <div style={{ color: "var(--text-2)", fontSize: 12.5, marginTop: 4, lineHeight: 1.25 }}>{label}</div>
    </div>
  );
}

function Rule({ children }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 10 }}>
      <span style={{ color: "var(--primary)", flex: "0 0 auto", marginTop: 1 }}>
        <Ic name="check" size={17} sw={2.4} />
      </span>
      <span style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.45 }}>{children}</span>
    </div>
  );
}

export default function InvitePage() {
  const navigate = useNavigate();
  const ui = useUI();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    Invite.get().then(setData).catch(() => setFailed(true));
  }, []);

  const link = data?.link;

  const copyLink = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); ui.toast("Ссылка скопирована", "check"); }
    catch { ui.toast(link); }
  };
  // Telegram сам подставит ссылку из url=, поэтому в share_text её нет — иначе задвоится.
  const shareLink = () => {
    if (!link) return;
    try { WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(data.share_text || "")}`); }
    catch { copyLink(); }
  };

  const inv = data?.stats?.invites;
  const clicks = data?.stats?.clicks?.total ?? 0;

  return (
    <div className="screen fade-in">
      <button className="tap" onClick={() => navigate("/profile")} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)", marginBottom: 8, fontWeight: 600 }}>
        <Ic name="chevronRight" size={18} sw={2.2} style={{ transform: "rotate(180deg)" }} /> Профиль
      </button>
      <h1 className="h-title" style={{ marginBottom: 14 }}>Пригласить друга</h1>

      {/* ссылка + шаринг */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <span style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--grad)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 48px", boxShadow: "0 8px 18px -6px var(--primary)" }}>
            <Ic name="sparkles" size={24} sw={1.8} style={{ color: "#fff" }} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: "-.2px" }}>Ваша личная ссылка</div>
            <div style={{ color: "var(--text-2)", fontSize: 13.5, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {failed ? "Не удалось загрузить" : (link || "Готовим ссылку…")}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sheet-btn" style={{ flex: 1 }} onClick={shareLink} disabled={!link}>Поделиться</button>
          <button className="sheet-btn ghost" onClick={copyLink} disabled={!link}
            style={{ flex: "0 0 auto", width: "auto", marginTop: 0, paddingInline: 22 }}>Копировать</button>
        </div>
      </div>

      {/* статистика */}
      <h3 className="sec-title" style={{ margin: "22px 4px 10px", fontSize: 18 }}>Ваша статистика</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <StatTile value={inv?.confirmed ?? "—"} label="Друзей засчитано" accent="var(--primary)" />
        <StatTile value={inv?.pending ?? "—"} label="На проверке" />
        <StatTile value={clicks} label="Переходов по ссылке" />
        <StatTile value={inv?.rejected ?? "—"} label="Не прошли проверку" />
      </div>

      {/* правила */}
      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 2 }}>Как засчитывается друг</div>
        <Rule>Он должен быть новым — тех, кто уже пользовался Bytwise, засчитать нельзя.</Rule>
        <Rule>Ему нужно открыть приложение и подписаться на наш канал.</Rule>
        <Rule>Через 24 часа проверяем: если он не вышел из канала и не заблокировал бота — друг засчитан.</Rule>
        <p className="muted" style={{ fontSize: 13, marginTop: 14, lineHeight: 1.45 }}>
          Результат проверки придёт вам сообщением от бота.
        </p>
      </div>
    </div>
  );
}
