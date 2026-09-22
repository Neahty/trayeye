// Экран «Пригласить друга»: личная короткая ссылка, шаринг и своя статистика.
// Ссылка ведёт в бота (?start=<code>), а не в мини-апп: так друг проходит /start
// с проверкой подписки на канал, и только тогда приглашение попадает в учёт.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import WebApp from "@twa-dev/sdk";
import { Invite } from "../api";
import { useApp } from "../AppContext";
import { useUI } from "../ui/UIProvider";
import { Ic } from "../components/icons";

// Русское склонение: «1 день / 2 дня / 5 дней».
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

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
  const { reload: reloadProfile } = useApp();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [claiming, setClaiming] = useState(null);

  // Ошибку показываем только когда показывать нечего: сбой фонового перезапроса после
  // получения подарка не должен подменять уже загруженную ссылку текстом ошибки.
  const loadedOnce = useRef(false);
  const load = () => Invite.get()
    .then((d) => { loadedOnce.current = true; setData(d); setFailed(false); })
    .catch(() => { if (!loadedOnce.current) setFailed(true); });
  useEffect(() => { load(); }, []);

  const link = data?.link;

  const copyLink = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); ui.toast("Ссылка скопирована", "check"); }
    catch { ui.toast(link); }
  };
  // Telegram сам подставит ссылку из url=, поэтому в share_text её нет - иначе задвоится.
  const shareLink = () => {
    if (!link) return;
    try { WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(data.share_text || "")}`); }
    catch { copyLink(); }
  };

  // Забрать подарок. Ошибка «уже получено» - не сбой, а гонка с кнопкой в боте:
  // просто перезагружаем список, чтобы карточка исчезла.
  const claimReward = async (r) => {
    if (claiming) return;
    setClaiming(r.id);
    try {
      const res = await Invite.claimReward(r.id);
      const until = new Date(res.expires_at).toLocaleDateString("ru-RU");
      ui.toast(`PRO до ${until} 🎉`, "check");
      await Promise.all([load(), reloadProfile()]);
    } catch (e) {
      if (e?.response?.data?.error === "already_claimed") { ui.toast("Этот подарок уже получен"); load(); }
      else ui.toast("Не удалось забрать подарок");
    } finally {
      setClaiming(null);
    }
  };

  const inv = data?.stats?.invites;
  const clicks = data?.stats?.clicks?.total ?? 0;
  const rule = data?.reward_rule;
  const pending = (data?.rewards || []).filter((r) => r.status === "pending");
  const claimed = (data?.rewards || []).filter((r) => r.status === "claimed");
  // Сколько друзей осталось до следующего подарка. Ступени считаются от общего числа
  // засчитанных, поэтому остаток - это дополнение до целой ступени.
  const toNext = rule && inv ? rule.per - (inv.confirmed % rule.per) : null;

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

      {/* подарки, которые ждут получения */}
      {pending.map((r) => (
        <div key={r.id} className="card" style={{ padding: 16, marginTop: 12, border: "1.5px solid var(--primary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 34, flex: "0 0 auto" }}>🎁</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: "-.2px" }}>
                Подарок: {r.days} {plural(r.days, "день", "дня", "дней")} PRO
              </div>
              <div style={{ color: "var(--text-2)", fontSize: 13.5, marginTop: 3 }}>
                За {rule ? r.tier * rule.per : r.tier} приглашённых друзей
              </div>
            </div>
          </div>
          <button className="sheet-btn" onClick={() => claimReward(r)} disabled={claiming === r.id}>
            {claiming === r.id ? "Забираю…" : "Забрать подарок"}
          </button>
        </div>
      ))}

      {/* прогресс до следующего подарка */}
      {rule && !pending.length && (
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 30, flex: "0 0 auto", opacity: .85 }}>🎁</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15.5, letterSpacing: "-.2px" }}>
                Каждые {rule.per} друзей - {rule.days} {plural(rule.days, "день", "дня", "дней")} PRO бесплатно
              </div>
              <div style={{ color: "var(--text-2)", fontSize: 13.5, marginTop: 3 }}>
                {inv ? `Ещё ${toNext} ${plural(toNext, "друг", "друга", "друзей")} до подарка` : "Считаем ваш прогресс…"}
                {claimed.length > 0 && ` · получено подарков: ${claimed.length}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* статистика */}
      <h3 className="sec-title" style={{ margin: "22px 4px 10px", fontSize: 18 }}>Ваша статистика</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <StatTile value={inv?.confirmed ?? "-"} label="Друзей засчитано" accent="var(--primary)" />
        <StatTile value={inv?.pending ?? "-"} label="На проверке" />
        <StatTile value={clicks} label="Переходов по ссылке" />
        <StatTile value={inv?.rejected ?? "-"} label="Не прошли проверку" />
      </div>

      {/* правила */}
      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 2 }}>Как засчитывается друг</div>
        <Rule>Он должен быть новым - тех, кто уже пользовался Bytwise, засчитать нельзя.</Rule>
        <Rule>Ему нужно открыть приложение и подписаться на наш канал.</Rule>
        <Rule>Через 24 часа проверяем: если он не вышел из канала и не заблокировал бота - друг засчитан.</Rule>
        {rule && (
          <Rule>За каждые {rule.per} засчитанных друзей - {rule.days} {plural(rule.days, "день", "дня", "дней")} PRO
            бесплатно. Подарок нужно забрать: кнопкой здесь или в сообщении от бота.</Rule>
        )}
        <p className="muted" style={{ fontSize: 13, marginTop: 14, lineHeight: 1.45 }}>
          Результат проверки придёт вам сообщением от бота.
        </p>
      </div>
    </div>
  );
}
