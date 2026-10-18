import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { SESSION_LOST, api, getSession, setSession } from "./lib/api";

// Кто вошёл: { role, kombinatName, schoolName, fullName, ... } или null.
const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [cabinet, setCabinet] = useState(null);
  const [ready, setReady] = useState(false);
  // Номер входа: ответ /auth/me по старой сессии, пришедший после входа по новой ссылке, не применяем.
  const loginSeq = useRef(0);

  useEffect(() => {
    if (!getSession()) {
      setReady(true);
      return;
    }
    const seq = loginSeq.current;
    // 401 сам сбрасывает сессию (api.js); сетевой сбой не должен выкидывать из кабинета.
    api.get("/auth/me")
      .then((r) => { if (seq === loginSeq.current) setCabinet(r.cabinet); })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // Комбинат отозвал ссылку или сессия истекла - сразу на экран входа, а не ошибки на каждой странице.
  useEffect(() => {
    const onLost = () => setCabinet(null);
    window.addEventListener(SESSION_LOST, onLost);
    return () => window.removeEventListener(SESSION_LOST, onLost);
  }, []);

  const loginWithLink = useCallback(async (linkToken) => {
    const r = await api.post("/auth/link", { token: linkToken });
    loginSeq.current += 1;
    setSession(r.token);
    setCabinet(r.cabinet);
    return r.cabinet;
  }, []);

  // Демо со стартовой страницы: кабинет комбината или директора выбранной школы, только просмотр.
  const loginDemo = useCallback(async (role, schoolId) => {
    const r = await api.post("/auth/demo", { role, school_id: schoolId });
    loginSeq.current += 1;
    setSession(r.token);
    setCabinet(r.cabinet);
    return r.cabinet;
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    setCabinet(null);
  }, []);

  return (
    <SessionContext.Provider value={{ cabinet, ready, loginWithLink, loginDemo, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
