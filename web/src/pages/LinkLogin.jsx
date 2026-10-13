import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSession } from "../session.jsx";

// Вход по личной ссылке /l/:token: меняем её на сессию и ведём в свой кабинет.
export default function LinkLogin() {
  const { token } = useParams();
  const { loginWithLink } = useSession();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode вызывает эффект дважды
    started.current = true;
    loginWithLink(token)
      .then((cabinet) => navigate(cabinet.role === "director" ? "/director" : "/kombinat", { replace: true }))
      .catch(() => setFailed(true));
  }, [token, loginWithLink, navigate]);

  if (failed) {
    return (
      <div className="pad">
        <h2>Ссылка не работает</h2>
        <p>Возможно, её отозвали. Попросите комбинат прислать новую.</p>
      </div>
    );
  }
  return <p className="muted pad">Входим...</p>;
}
