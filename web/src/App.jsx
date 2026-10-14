import { Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider, useSession } from "./session.jsx";
import Layout from "./components/Layout.jsx";
import { Loading } from "./components/ui.jsx";
import LinkLogin from "./pages/LinkLogin.jsx";
import NoAccess from "./pages/NoAccess.jsx";
import DirectorHome from "./pages/director/Home.jsx";
import DirectorClasses from "./pages/director/Classes.jsx";
import DirectorStats from "./pages/director/Stats.jsx";
import DirectorMenu from "./pages/director/Menu.jsx";
import DirectorSettings from "./pages/director/Settings.jsx";
import KombinatHome from "./pages/kombinat/Home.jsx";
import KombinatSchools from "./pages/kombinat/Schools.jsx";
import KombinatSchool from "./pages/kombinat/School.jsx";
import KombinatStats from "./pages/kombinat/Stats.jsx";
import KombinatProducts from "./pages/kombinat/Products.jsx";
import KombinatSuppliers from "./pages/kombinat/Suppliers.jsx";
import KombinatSettings from "./pages/kombinat/Settings.jsx";

const HOME = { director: "/director", kombinat: "/kombinat" };

// Пускает в раздел только нужную роль, остальных отправляет к себе домой.
// Layout общий для всех страниц роли: меню и шапка не пересоздаются при переходах.
function RoleGate({ role }) {
  const { cabinet, ready } = useSession();
  if (!ready) return <Loading />;
  if (!cabinet) return <Navigate to="/" replace />;
  if (cabinet.role !== role) return <Navigate to={HOME[cabinet.role]} replace />;
  return <Layout />;
}

function Root() {
  const { cabinet, ready } = useSession();
  if (!ready) return <Loading />;
  return cabinet ? <Navigate to={HOME[cabinet.role]} replace /> : <NoAccess />;
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/" element={<Root />} />
        <Route path="/l/:token" element={<LinkLogin />} />

        <Route path="/director" element={<RoleGate role="director" />}>
          <Route index element={<DirectorHome />} />
          <Route path="classes" element={<DirectorClasses />} />
          <Route path="stats" element={<DirectorStats />} />
          <Route path="menu" element={<DirectorMenu />} />
          <Route path="settings" element={<DirectorSettings />} />
        </Route>

        <Route path="/kombinat" element={<RoleGate role="kombinat" />}>
          <Route index element={<KombinatHome />} />
          <Route path="schools" element={<KombinatSchools />} />
          <Route path="schools/:id" element={<KombinatSchool />} />
          <Route path="stats" element={<KombinatStats />} />
          <Route path="products" element={<KombinatProducts />} />
          <Route path="suppliers" element={<KombinatSuppliers />} />
          <Route path="settings" element={<KombinatSettings />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
