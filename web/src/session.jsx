import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getSession, setSession } from "./lib/api";

// Кто вошёл: { role, kombinatName, schoolName, fullName, ... } или null.
const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [cabinet, setCabinet] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getSession()) {
      setReady(true);
      return;
    }
    api.get("/auth/me")
      .then((r) => setCabinet(r.cabinet))
      .catch(() => setSession(null))
      .finally(() => setReady(true));
  }, []);

  const loginWithLink = useCallback(async (linkToken) => {
    const r = await api.post("/auth/link", { token: linkToken });
    setSession(r.token);
    setCabinet(r.cabinet);
    return r.cabinet;
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    setCabinet(null);
  }, []);

  return (
    <SessionContext.Provider value={{ cabinet, ready, loginWithLink, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
