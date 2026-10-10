import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Auth, setToken } from "../api";
import { useAuth } from "../App.jsx";

export default function Login() {
  const navigate = useNavigate();
  const { setAdmin } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const data = await Auth.login({ identifier, password, totp: totp || undefined });
      setToken(data.token);
      setAdmin(data.admin);
      navigate("/");
    } catch (e2) {
      const code = e2?.response?.data?.error;
      if (code === "totp_required") { setNeedTotp(true); setErr("Введите код из приложения-аутентификатора."); }
      else if (code === "invalid_totp") setErr("Неверный код 2FA.");
      else if (code === "locked") setErr("Слишком много попыток. Попробуйте позже.");
      else if (code === "blocked") setErr("Аккаунт заблокирован.");
      else if (code === "ip_not_allowed") setErr("Доступ с этого IP запрещён.");
      else setErr("Неверный логин или пароль.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Бизнес - IT компания · Админка</h1>
        <div className="sub">Панель управления. Вход только для администраторов.</div>
        {err && <div className="err">{err}</div>}
        <div className="field">
          <label>Email или Telegram ID</label>
          <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Пароль</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {needTotp && (
          <div className="field">
            <label>Код из приложения-аутентификатора</label>
            <input className="input" value={totp} onChange={(e) => setTotp(e.target.value)} inputMode="numeric" placeholder="000000" />
          </div>
        )}
        <button className="btn" style={{ width: "100%", marginTop: 8 }} disabled={busy}>
          {busy ? "Вход…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
