// Экран входа для приложения, установленного на телефон.
// Внутри Telegram он никогда не показывается: там вход идёт по initData молча.
// Здесь же взять личность неоткуда, поэтому просим код, который выдаёт бот по /pwa.
import { useState } from "react";
import { loginWithCode } from "../api";
import { Ic } from "../components/icons";

export default function CodeLogin({ onDone }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e?.preventDefault();
    if (busy || code.length < 6) return;
    setBusy(true);
    setErr(null);
    try {
      await loginWithCode(code);
      onDone?.();
    } catch (e2) {
      const s = e2?.response?.status;
      if (s === 401) setErr("Код неверный или уже истёк. Запроси новый: /pwa в боте.");
      else if (s === 403) setErr("Доступ закрыт.");
      else setErr("Не удалось войти. Проверь интернет и попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen fade-in" style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "100vh", gap: 18 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 72, height: 72, borderRadius: 22, margin: "0 auto 16px",
          background: "var(--grad)", display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <Ic name="shield" size={34} sw={2} style={{ color: "#fff" }} />
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Вход в Bytwise</h1>
        <p style={{ color: "var(--text-2)", marginTop: 8, lineHeight: 1.5 }}>
          Отправь боту команду <b>/pwa</b> - он пришлёт код. Введи его здесь, это нужно один раз.
          <br />
          Если код не пришёл сразу - запрос ушёл на подтверждение администратору.
        </p>
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          className="sheet-input"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          style={{ textAlign: "center", fontSize: 30, fontWeight: 700, letterSpacing: 8 }}
        />
        {err && <div style={{ color: "var(--red)", textAlign: "center", fontSize: 14 }}>{err}</div>}
        <button className="btn-primary" type="submit" disabled={busy || code.length < 6}>
          {busy ? "Проверяем…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
