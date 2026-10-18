// «Привязать Telegram»: QR-код (сканировать телефоном) или код из 6 символов для бота.
// Директор привязывает себя или выдаёт код повару, комбинат - себя.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { api } from "../lib/api";
import { fadeMotion, motionTokens, springs } from "../lib/motion";
import { useModal } from "../lib/hooks";
import { errorText } from "./ui.jsx";

const ROLE_TEXT = { director: "директор", cook: "повар", kombinat: "комбинат" };
const CHATS_POLL_MS = 4000;

export function TelegramGlyph({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M21.5 4.5 2.9 11.6c-1 .4-1 1.6.1 1.9l4.6 1.4 1.8 5.5c.3.8 1.3 1 1.9.4l2.6-2.4 4.7 3.5c.8.6 1.9.1 2.1-.9L23 5.9c.2-1.1-.6-1.8-1.5-1.4Zm-4 4.3-7.6 6.9-.3 3-1.3-4.1 8.6-5.6c.4-.3.9.3.6-.2Z" fill="currentColor" />
    </svg>
  );
}

function timeLeft(seconds) {
  if (seconds <= 0) return "код истёк - возьмите новый";
  return `действует ещё ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function TelegramDialog({ role, onClose }) {
  const ref = useRef(null);
  useModal(ref, onClose);
  const base = `/${role}/telegram`;
  const [target, setTarget] = useState(role === "director" ? "director" : "kombinat");
  const [code, setCode] = useState(null);
  const [qr, setQr] = useState(null);
  const [error, setError] = useState(null);
  const [chats, setChats] = useState(null);
  const [bot, setBot] = useState(null);
  const [left, setLeft] = useState(null);
  const linkedCount = useRef(null);

  const newCode = useCallback(async (who) => {
    setError(null);
    setQr(null);
    try {
      const r = await api.post(`${base}/code`, role === "director" ? { role: who } : {});
      setCode(r);
      setQr(await QRCode.toDataURL(r.url, { margin: 1, width: 440, color: { dark: "#1d1d1d", light: "#ffffff" } }));
    } catch (err) {
      setCode(null);
      setError(errorText(err));
    }
  }, [base, role]);

  useEffect(() => { newCode(target); }, [newCode, target]);

  // Список подключённых обновляется сам: телефон привязался - сразу видно, и выдаём новый код
  // (старый одноразовый уже использован).
  useEffect(() => {
    let alive = true;
    const load = () => api.get(base).then((r) => {
      if (!alive) return;
      setBot(r.bot);
      setChats(r.chats);
      if (linkedCount.current !== null && r.chats.length > linkedCount.current) newCode(target);
      linkedCount.current = r.chats.length;
    }, () => {});
    load();
    const timer = setInterval(load, CHATS_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [base, newCode, target]);

  useEffect(() => {
    if (!code) return undefined;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(code.expires_at) - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [code]);

  const unlink = async (chatId) => {
    try {
      await api.del(`${base}/${chatId}`);
      setChats((list) => list.filter((c) => c.chat_id !== chatId));
      linkedCount.current = Math.max(0, (linkedCount.current || 1) - 1);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const pretty = code ? `${code.code.slice(0, 3)}-${code.code.slice(3)}` : "";
  const forCook = target === "cook";

  return <>
    <motion.div className="overlay" {...fadeMotion} onClick={onClose} />
    <motion.div
      ref={ref}
      className="tg-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Привязать Telegram"
      initial={{ opacity: 0, y: -motionTokens.distance.md, scale: motionTokens.scale.subtle }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -motionTokens.distance.sm, scale: motionTokens.scale.subtle }}
      transition={springs.snappy}
    >
      <div className="tg-head">
        <h2><TelegramGlyph size={20} />Привязать Telegram</h2>
        <button type="button" className="tg-close" onClick={onClose} aria-label="Закрыть">×</button>
      </div>

      {role === "director" && (
        <div className="tg-tabs" role="tablist" aria-label="Для кого код">
          {[["director", "Для себя"], ["cook", "Для повара"]].map(([who, label]) => (
            <button key={who} type="button" role="tab" aria-selected={target === who}
              className={target === who ? "active" : ""} onClick={() => setTarget(who)}>{label}</button>
          ))}
        </div>
      )}

      <p className="tg-hint">
        {forCook
          ? "Покажите повару: он сканирует QR телефоном или вводит код в боте. Потом просто фотографирует подносы после еды."
          : "Отсканируйте QR телефоном или откройте бота и пришлите код. В боте будут сводка за день и уведомления."}
      </p>

      <div className="tg-body">
        <div className="tg-qr">
          {qr ? <img src={qr} alt="QR-код для привязки бота" width="200" height="200" /> : <div className="skeleton tg-qr-empty" />}
        </div>
        <div className="tg-code">
          <div className="tg-code-label">Код для бота</div>
          <div className="tg-code-value" aria-live="polite">{pretty || "···-···"}</div>
          {left !== null && code && <div className={left > 0 ? "muted" : "error"}>{timeLeft(left)}</div>}
          <div className="tg-actions">
            <button type="button" onClick={() => newCode(target)}>Новый код</button>
            {code && bot && <a className="tg-open" href={code.url} target="_blank" rel="noreferrer">Открыть @{bot}</a>}
          </div>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="tg-linked">
        <div className="tg-code-label">Подключены</div>
        {chats === null ? null : chats.length === 0 ? <p className="muted">Пока никого.</p> : (
          <ul>
            {chats.map((c) => (
              <li key={c.chat_id}>
                <span className="tg-name">{c.tg_name || "Без имени"}</span>
                <span className="muted">{ROLE_TEXT[c.role]}</span>
                <button type="button" className="tg-unlink" onClick={() => unlink(c.chat_id)}>Отвязать</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  </>;
}

// Кнопка «Привязать Telegram» на страницах настроек. Окно - в body: у страницы во время
// анимации есть transform, а он ломает position: fixed.
export function TelegramButton({ role, disabled = false, onClosed }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    onClosed?.();
  }, [onClosed]);
  return <>
    <button type="button" className="secondary tg-menu-item" disabled={disabled} onClick={() => setOpen(true)}>
      <TelegramGlyph size={16} />Привязать Telegram
    </button>
    {createPortal(<AnimatePresence>{open && <TelegramDialog key="telegram" role={role} onClose={close} />}</AnimatePresence>, document.body)}
  </>;
}
