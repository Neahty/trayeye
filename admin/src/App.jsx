import { createContext, useContext, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { Auth } from "./api";
import { LiveProvider } from "./lib.jsx";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Users from "./pages/Users.jsx";
import Employees from "./pages/Employees.jsx";
import EmployeeCard from "./pages/EmployeeCard.jsx";
import Invites from "./pages/Invites.jsx";
import InviteCard from "./pages/InviteCard.jsx";
import Subscriptions from "./pages/Subscriptions.jsx";
import Finance from "./pages/Finance.jsx";
import AIAnalytics from "./pages/AIAnalytics.jsx";
import Scans from "./pages/Scans.jsx";
import Notifications from "./pages/Notifications.jsx";
import Funnel from "./pages/Funnel.jsx";
import Logs from "./pages/Logs.jsx";
import Support from "./pages/Support.jsx";
import SupportTicket from "./pages/SupportTicket.jsx";
import QuestsPage from "./pages/Quests.jsx";
import LinksPage from "./pages/Links.jsx";
import SettingsPage from "./pages/Settings.jsx";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function Protected({ children }) {
  const { admin, ready } = useAuth();
  if (!ready) return <div className="loading"><div className="spinner" /></div>;
  if (!admin) return <Navigate to="/login" replace />;
  return children;
}

function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Auth.me({ skipAuthRedirect: true }).then((d) => setAdmin(d.admin)).catch(() => setAdmin(null)).finally(() => setReady(true));
  }, []);

  return <AuthCtx.Provider value={{ admin, setAdmin, ready }}>{children}</AuthCtx.Provider>;
}

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <Protected>
                <LiveProvider>
                <Layout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/users" element={<Users />} />
                    <Route path="/employees" element={<Employees />} />
                    <Route path="/employees/:id" element={<EmployeeCard />} />
                    <Route path="/invites" element={<Invites />} />
                    <Route path="/invites/:id" element={<InviteCard />} />
                    <Route path="/subscriptions" element={<Subscriptions />} />
                    <Route path="/finance" element={<Finance />} />
                    <Route path="/ai" element={<AIAnalytics />} />
                    <Route path="/scans" element={<Scans />} />
                    <Route path="/notifications" element={<Notifications />} />
                    <Route path="/funnel" element={<Funnel />} />
                    <Route path="/support" element={<Support />} />
                    <Route path="/support/:id" element={<SupportTicket />} />
                    <Route path="/quests" element={<QuestsPage />} />
                    <Route path="/links" element={<LinksPage />} />
                    <Route path="/logs" element={<Logs />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Layout>
                </LiveProvider>
              </Protected>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
