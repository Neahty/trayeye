import { Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./session.jsx";
import Layout from "./components/Layout.jsx";
import LinkLogin from "./pages/LinkLogin.jsx";
import NoAccess from "./pages/NoAccess.jsx";
import DirectorHome from "./pages/director/Home.jsx";
import DirectorClasses from "./pages/director/Classes.jsx";
import DirectorStats from "./pages/director/Stats.jsx";
import DirectorMenu from "./pages/director/Menu.jsx";
import DirectorSettings from "./pages/director/Settings.jsx";
import KombinatHome from "./pages/kombinat/Home.jsx";
import KombinatSchools from "./pages/kombinat/Schools.jsx";
import KombinatStats from "./pages/kombinat/Stats.jsx";
import KombinatSuppliers from "./pages/kombinat/Suppliers.jsx";
import KombinatSettings from "./pages/kombinat/Settings.jsx";

const HOME = { director: "/director", kombinat: "/kombinat" };

// Пускает в раздел только нужную роль, остальных отправляет к себе домой.
function RoleGate({ role, children }) {
  const { cabinet, ready } = useSession();
  if (!ready) return <p className="muted pad">Загрузка...</p>;
  if (!cabinet) return <Navigate to="/" replace />;
  if (cabinet.role !== role) return <Navigate to={HOME[cabinet.role]} replace />;
  return <Layout>{children}</Layout>;
}

function Root() {
  const { cabinet, ready } = useSession();
  if (!ready) return <p className="muted pad">Загрузка...</p>;
  return cabinet ? <Navigate to={HOME[cabinet.role]} replace /> : <NoAccess />;
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/" element={<Root />} />
        <Route path="/l/:token" element={<LinkLogin />} />

        <Route path="/director" element={<RoleGate role="director"><DirectorHome /></RoleGate>} />
        <Route path="/director/classes" element={<RoleGate role="director"><DirectorClasses /></RoleGate>} />
        <Route path="/director/stats" element={<RoleGate role="director"><DirectorStats /></RoleGate>} />
        <Route path="/director/menu" element={<RoleGate role="director"><DirectorMenu /></RoleGate>} />
        <Route path="/director/settings" element={<RoleGate role="director"><DirectorSettings /></RoleGate>} />

        <Route path="/kombinat" element={<RoleGate role="kombinat"><KombinatHome /></RoleGate>} />
        <Route path="/kombinat/schools" element={<RoleGate role="kombinat"><KombinatSchools /></RoleGate>} />
        <Route path="/kombinat/stats" element={<RoleGate role="kombinat"><KombinatStats /></RoleGate>} />
        <Route path="/kombinat/suppliers" element={<RoleGate role="kombinat"><KombinatSuppliers /></RoleGate>} />
        <Route path="/kombinat/settings" element={<RoleGate role="kombinat"><KombinatSettings /></RoleGate>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
